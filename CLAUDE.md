# narajangteo — g2b 채용대행 공고 자동 수집·요약·발송 시스템

**Version 1 · 2026-05-13**

매일 09:00 KST에 나라장터(g2b.go.kr)에서 최근 5일치 "채용" 키워드 입찰공고를 자동 수집하고, GPT로 채용대행 여부 판단·핵심 정보 요약 후 등록된 수신자에게 메일 발송. 관리자 페이지에서 보관 공고 조회·수신자 관리·수동 크롤링 가능.

---

## 1. 핵심 흐름

```
[매일 09:00 KST]  systemd timer (g2b-daily.timer)
        ↓
[crawl/cron.js — 5일 윈도우 sliding]
1. 검색 API 호출 (selectBidPbacScrollTypeList.do) → 최대 100건 메타
2. DB 조회 → bid_no 비교 → 신규만 추림 (GPT 호출 전, 비용 절감)
3. 신규만 디테일 enrich
   ├─ selectItemAnncMngV.do (사업금액·진행정보·담당자)
   ├─ selectUntyAtchFileList.do (첨부 파일 리스트)
   └─ findPreviousAgencies (이전 채용대행 기록 매칭 — 4단계 fuzzy)
4. 신규만 GPT 분류 (gpt-4.1-mini, 캐시)
   - 채용대행 vs 그 외 채용업무(아웃소싱/박람회/시스템 등)
5. 신규 풀파이프라인 (순차)
   ├─ Playwright (Google Chrome) 로 g2b 메인 → 검색 → 공고 클릭 → 첨부 클릭
   ├─ fileUpload.do iframe-navigation POST body 가로채기
   ├─ httpx fetch 로 replay → binary 응답 추출
   ├─ 첨부 디스크 저장 (server/data/files/<bidNo>/) — admin 재다운로드용
   ├─ 텍스트 추출 (pdf-parse / @rhwp/core WASM)
   └─ GPT 요약 (사용자 정의 포맷: 업체명/공고명/채용규모/담당자/제출기간/가격/평가정보)
6. DB INSERT (notices 테이블)
7. 마크다운 리포트 생성 + inline-style HTML 변환
8. 활성 수신자에게 메일 발송 (메일플러그 SMTP)
   - 본문: HTML 카드 (업체명·공고명 강조)
   - 첨부 1: report-YYYY-MM-DD.md (전체 분석 마크다운 원본)
   - 첨부 2: files-YYYY-MM-DD.zip ← AI 판단 채용대행 공고만, <bidNo>_<공고명>/ 폴더 구조
9. cron_runs 로그 기록
```

---

## 2. 기술 스택

| 영역 | 기술 |
|---|---|
| Backend | Node 20 LTS · Express · ES Modules |
| Frontend | React 18 · Vite · React Router |
| DB | MySQL 8 (AWS RDS) — utf8mb4 |
| 헤드리스 자동화 | Playwright + Google Chrome (Ubuntu 26.04 호환) |
| 텍스트 추출 | pdf-parse · @rhwp/core (WASM, .hwp/.hwpx) |
| AI | OpenAI gpt-4.1-mini (분류 + 요약 + fuzzy 매칭) |
| 이메일 | nodemailer + 메일플러그 SMTP (465, SSL) |
| 인증 | LOGIN_KEY 단순 키 + HttpOnly 쿠키 (90일) |
| 호스팅 | AWS EC2 (Ubuntu 26.04, t3.micro + Swap 2GB) |
| 리버스 프록시 | nginx 80 → 127.0.0.1:3001 |
| 스케줄러 | systemd timer (cron 대체) |

---

## 3. 디렉토리 구조

```
narajangteo/
├── server/
│   ├── index.js                ← Express 엔트리 (port 3001)
│   ├── cron.js                 ← 일일 자동 실행 (--days=5)
│   ├── migrate.js              ← RDS 스키마 적용
│   ├── recipients.js           ← 수신자 CLI (테스트용)
│   ├── schema.sql              ← MySQL 스키마
│   ├── .env                    ← 환경변수 (git ignored)
│   ├── data/files/             ← 첨부 디스크 저장소 (런타임 생성, git ignored)
│   └── lib/
│       ├── auth.js             ← LOGIN_KEY 인증 + 쿠키
│       ├── db.js               ← mysql2 커넥션 풀 + 헬퍼
│       ├── utils.js            ← clean/normalize/money + browserLaunchOpts
│       ├── classify.js         ← 정규식 1차 분류 (폴백)
│       ├── aiClassify.js       ← GPT 채용대행 분류 + 캐시
│       ├── g2bApi.js           ← g2b 검색/상세/첨부 API + 쿠키 수집
│       ├── automate.js         ← Playwright 자동화 (메인→검색→클릭)
│       ├── textExtract.js      ← PDF/HWP/HWPX → 텍스트
│       ├── summarize.js        ← GPT 요약
│       ├── history.js          ← 이전 채용대행 기록 매칭 (4단계 fuzzy)
│       ├── fileStore.js        ← 첨부 디스크 보존
│       ├── report.js           ← 마크다운 + inline-HTML 생성
│       └── email.js            ← nodemailer 메일플러그
├── client/
│   ├── src/
│   │   ├── App.jsx             ← BrowserRouter + Protected 라우트
│   │   ├── auth.js             ← login/check/logout + authFetch
│   │   └── pages/
│   │       ├── Login.jsx
│   │       ├── AdminDashboard.jsx        ← 통계 + 최근 cron
│   │       ├── AdminNotices.jsx          ← 보관 공고 목록 (필터·검색)
│   │       ├── AdminNoticeDetail.jsx     ← 단건 + 첨부 다운로드
│   │       ├── AdminRecipients.jsx       ← 수신자 CRUD (인라인 편집)
│   │       └── Crawl.jsx                 ← 수동 크롤링 (기존 흐름, DB X)
│   └── vite.config.js          ← proxy /api → 127.0.0.1:3001
└── _ncs_data/                  ← 정적 데이터 + GPT 캐시
    ├── agency_history.json     ← 엑셀 인덱스 (699기관 × 4066건, 2020~2025)
    ├── inst_map.json           ← GPT 기관명 정규화 캐시 (1840건)
    ├── ai_classify_cache.json  ← GPT 분류 결과 캐시
    ├── gpt_inst_match_cache.json  ← fuzzy 매칭 캐시
    ├── parse_and_export.py     ← 엑셀 재빌드
    ├── normalize_with_gpt.py   ← 기관명 정규화 1회 실행
    └── build_history_index.py  ← agency_history.json 재빌드
```

---

## 4. DB 스키마 (RDS MySQL — `g2b` database)

```sql
CREATE TABLE notices (
  bid_no        VARCHAR(40) PRIMARY KEY,
  name          VARCHAR(500) NOT NULL,
  agency        VARCHAR(200),       -- 공고기관
  demander      VARCHAR(200),       -- 수요기관
  bgt_amt       VARCHAR(50),        -- 사업금액
  prsp_prce     VARCHAR(50),        -- 추정가격
  scsbd_mthd    VARCHAR(100),       -- 낙찰방법
  pnpr_mtho     VARCHAR(100),       -- 예가방법
  pbanc_knd     VARCHAR(100),
  status        VARCHAR(50),
  posted_at     VARCHAR(50),
  deadline      VARCHAR(50),
  ai_is_agent   TINYINT(1),         -- 1=채용대행 / 0=그 외 / NULL=GPT 실패
  ai_reason     TEXT,
  detail        JSON,               -- 진행정보·담당자·첨부 메타
  prev_history  JSON,               -- [{year, agencies:[]}, ...]
  summary_md    MEDIUMTEXT,         -- GPT 요약 마크다운
  files_meta    JSON,               -- [{name, size, path}, ...]
  email_sent_at DATETIME,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email_sent (email_sent_at),
  INDEX idx_created (created_at),
  INDEX idx_ai_agent (ai_is_agent)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE cron_runs (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  started_at   DATETIME NOT NULL,
  finished_at  DATETIME,
  status       ENUM('running','success','failed') DEFAULT 'running',
  total_found  INT,
  new_count    INT,
  email_sent   TINYINT(1) DEFAULT 0,
  error_msg    TEXT,
  INDEX idx_started (started_at)
);

CREATE TABLE recipients (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  email       VARCHAR(255) UNIQUE NOT NULL,
  name        VARCHAR(100),
  active      TINYINT(1) DEFAULT 1,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_active (active)
);
```

---

## 5. 환경변수 (`server/.env`)

```bash
# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini

# RDS MySQL
DB_HOST=isbr-mysql.cp2qcyseah5y.ap-northeast-2.rds.amazonaws.com
DB_PORT=3306
DB_USER=isbr_user
DB_PASSWORD=...
DB_NAME=g2b

# 메일플러그 SMTP (isbr-card-system 동일 패턴)
SMTP_HOST=smtp.mailplug.co.kr
SMTP_PORT=465
EMAIL_USER=tax@insabr.kr
EMAIL_PASS=...

# Admin 로그인 키
LOGIN_KEY=...

# EC2 Ubuntu 26.04 — Playwright Chromium 미지원 우회
PW_BROWSER_PATH=/usr/bin/google-chrome
```

---

## 6. API 라우트

### 공용 (인증 X)
- `GET  /api/health`
- `POST /api/auth/login` — `{key}` → 쿠키 발급
- `GET  /api/auth/check`
- `POST /api/auth/logout`
- `POST /api/refresh-session` — 쿠키 재발급
- `POST /api/crawl` — 수동 크롤링 100건 (검색+enrich+GPT분류, **DB 저장 X**)
- `POST /api/download-zip` — 수동 ZIP 다운로드 (자동화 + 텍스트 + GPT 요약, **DB 저장 X**)

### Admin (인증 필요)
- `GET  /api/admin/stats` — 대시보드 통계
- `GET  /api/admin/notices?filter=all|agent|other&limit=300`
- `GET  /api/admin/notices/:bidNo` — 단건 + 디스크 파일 리스트
- `GET  /api/admin/notices/:bidNo/files/:name` — 파일 다운로드
- `GET  /api/admin/recipients`
- `POST /api/admin/recipients` — `{email, name}`
- `PATCH /api/admin/recipients/:id` — `{email?, name?, active?}`
- `DELETE /api/admin/recipients/:email` — soft delete

---

## 7. 운영 (EC2)

### 인프라
- EC2: t3.micro Ubuntu 26.04 LTS + EBS 20GB + Swap 2GB
- Public IP: `54.180.150.211` (Elastic IP 권장)
- RDS: `isbr-mysql.cp2qcyseah5y.ap-northeast-2.rds.amazonaws.com:3306` (db.t4g.micro)
- Security Group 인바운드: SSH 22 (관리자 IP), HTTP 80, HTTPS 443
- RDS SG: 3306 ← EC2 SG 허용

### systemd 유닛
```
/etc/systemd/system/g2b-api.service     ← Express 데몬 (Restart=on-failure)
/etc/systemd/system/g2b-daily.service   ← oneshot, ExecStart=node cron.js --days=5
/etc/systemd/system/g2b-daily.timer     ← OnCalendar=*-*-* 09:00:00
```

### nginx
```
/etc/nginx/sites-enabled/g2b
- listen 80
- root /opt/g2b/client/dist (정적 호스팅)
- location /api/ → proxy_pass http://127.0.0.1:3001
- proxy_read_timeout 600s (long cron 호출 대비)
```

### 로그
- `/var/log/g2b/api.log` · `api.err`
- `/var/log/g2b/cron.log` · `cron.err`

---

## 8. 명령어 cheatsheet

### 로컬 (개발)
```bash
# 서버
cd server
npm install
node migrate.js                        # RDS 스키마 적용 (1회)
node recipients.js add foo@bar.com 이름  # 수신자 추가
node recipients.js list
npm start                              # Express + watch 모드

# 프론트 (별도 터미널)
cd client
npm install
npm run dev                            # http://localhost:5173
```

### EC2 (운영)
```bash
ssh -i ~/Downloads/narajangteo.pem ubuntu@54.180.150.211

# 코드 업데이트
cd /opt/g2b && git pull
cd server && npm install                # 의존성 변경 시
cd ../client && npm run build           # 프론트 변경 시
sudo systemctl restart g2b-api          # API 재시작

# 수동 cron 실행
sudo systemctl start g2b-daily.service  # 백그라운드
# 또는
cd /opt/g2b/server && node cron.js --days=5

# 상태 확인
systemctl list-timers g2b-daily.timer   # 다음 자동 실행 시각
systemctl status g2b-api
tail -f /var/log/g2b/cron.log
```

### Admin 접속
```
http://54.180.150.211           ← 자동으로 /login 리다이렉트
LOGIN_KEY 입력 → /admin
```

---

## 9. 알려진 제약 / 우회 처리

| 제약 | 우회 |
|---|---|
| g2b `fileUpload.do` 가 일회용 `k01` 암호문 요구 | Playwright로 사람처럼 클릭 → `page.on('request')` 로 body 가로채 → fetch 로 replay |
| Ubuntu 26.04 LTS 에서 Playwright Chromium 미지원 | Google Chrome 시스템 설치 + `PW_BROWSER_PATH=/usr/bin/google-chrome` 환경변수 |
| EC2 t3.micro 메모리 908 MiB 빠듯 | Swap 2GB 추가 (`/swapfile`) — Chromium peak ~650MB |
| `.hwp` (한컴 폐쇄 포맷) 텍스트 추출 야생 | `@rhwp/core` WASM 사용. PDF 있으면 PDF 우선 (g2b 거의 항상 .pdf 동봉) |
| 메일플러그 PC 클라이언트가 multipart/alternative 에서 text/plain 우선 표시 | nodemailer 호출 시 `text` 옵션 제거 + 모든 CSS inline `style` 속성으로 (외부 `<link>` `<style>` 금지) |
| g2b 검색 결과에서 공고번호 클릭 실패 케이스 | 폴백 chain: 공고명 첫 단어 → 둘째 단어 → bidNo → 결과 grid 첫 한글 셀 |
| GPT 분류 비용 누적 | 캐시 (`ai_classify_cache.json`) + 신규만 호출 (DB 비교 후) |
| 같은 공고명 다른 변형(공백/오타) | inst_map.json 에 GPT 정규화 캐시 1840건 (공백 통합 + 명백 오타 정정) |

---

## 10. 이전 채용대행 기록 매칭 (4단계)

`server/lib/history.js`:
1. **정확 일치** — `agency_history.json` key 와 동일
2. **공백/기호 정규화 일치** — `re.sub(/[\s·\-_(),.'"]+/g, '')`
3. **부분 일치** — 한쪽이 prefix 이고 길이차 ≤ 4
4. **GPT fuzzy 매칭** — 699 후보 중 가장 가까운 1건 또는 빈 (캐시: `gpt_inst_match_cache.json`)

매칭 결과는 detail enrich 단계에서 각 공고에 `prevHistory: [{year, agencies:[]}, ...]` 로 첨부.

---

## 11. 데이터 출처

`_ncs_data/agency_history.json` 의 원본은 blog.naver.com/6860code 의 연도별 NCS 채용대행 정리 6편 (2020~2025).
- 1832개 raw 표기 → GPT 정규화로 699 unique 기관, 4066건
- 컬럼: 연도 · 채용대행사 · 시기(상/하반기) · 공공기관(정제) · 계약일 · 원본 · 출처 블로그
- 결과 엑셀: `NCS_채용대행_연도별수주현황.xlsx` (12개 시트 — 전체/피벗/연도별/인사바른/정규화 로그)

---

## 12. 향후 작업 후보 (v2~)

- [ ] HTTPS 적용 (Let's Encrypt + 도메인)
- [ ] g2b 검색 API direct (Playwright 거치지 않고 우리가 cookie 받아 호출) — 이미 cron 흐름에 부분 적용. 자동 다운로드는 그대로 Playwright
- [ ] 5일 윈도우 외 옛 공고 archive 정책 (혹은 영구 보관)
- [ ] EC2 인스턴스 type 업그레이드 (t3.small/medium) — 메모리 안정성
- [ ] 메일 발송 실패 시 재시도 / Slack 알림
- [ ] 텍스트 추출 실패한 공고 재분석 큐
- [ ] `_ncs_data/agency_history.json` 자동 업데이트 (블로거가 새 글 올릴 때마다)
- [ ] OpenAPI(공공데이터포털 BidPublicInfoService) 병행 사용 — 메타 안정성
- [ ] 사용자별 권한 분리 (현재는 단일 LOGIN_KEY)
- [ ] 첨부 디스크 자동 정리 (오래된 공고 파일 archive/삭제)

---

## 13. 코드 변경 후 배포 흐름

```
[로컬]
1. 코드 수정
2. git add . && git commit -m "..."
3. git push origin main

[EC2]
4. ssh -i ... ubuntu@54.180.150.211
5. cd /opt/g2b && git pull
6. (server 의존성 추가 시) cd server && npm install
7. (client 변경 시) cd ../client && npm run build
8. sudo systemctl restart g2b-api
```

> ⚠️ Repo 가 **public 일 때만 `git pull` 정상 동작** (현재 public). private 으로 돌리면 EC2 에서 토큰 인증 필요.

---

## 14. Version 1 완성 시점 운영 메타

| 항목 | 값 |
|---|---|
| 완성일 | 2026-05-13 |
| EC2 | t3.micro · 54.180.150.211 · Ubuntu 26.04 · Swap 2GB |
| RDS | db.t4g.micro · g2b database |
| 등록 수신자 | min/young/kys/hhm @insabr.kr (4명) |
| 발신자 | `"g2b 채용 크롤러" <tax@insabr.kr>` |
| 첫 자동 실행 | 2026-05-14 09:00 KST |
| 검색 윈도우 | 최근 5일 (sliding, 게시일 기준 `bidDateType=R`) |
| GPT 모델 | gpt-4.1-mini |
| 월 운영비 추정 | ~$50 (EC2 + RDS + OpenAI) |
