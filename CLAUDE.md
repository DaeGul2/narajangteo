# narajangteo — g2b 채용대행 공고 자동 수집·요약·발송 + 출퇴근 관리 + 해외 공고 크롤링

**Version 4 · 2026-09-16**

> v1 (2026-05-13): g2b 채용 크롤러 + 입찰 모듈
> v2 (2026-05-19): 출퇴근 관리 시스템 추가 (지각 룰 v1, 공휴일 캘린더, 리포트)
> v3 (2026-07-20): 해외 공고 크롤링 (공공기관 방콕지사 모니터링) + 수신자 직원 셀렉트 전환
> v4 (2026-09-16): 해외 공고 — 나라장터 소스 추가 + 규칙/GPT 2단계 판별(A/B/X) + 마감 D-day·금액·주제 요약 + 하루 2회 실행

---

## ⚠️ 두 사업은 완전히 별개

- **인사바른 채용대행** = g2b `채용` 크롤러 (`cron.js`, `notices`, `recipients`, `aiClassify.js`, 11:00 KST). **v4 에서 손대지 않음.**
- **태국 법인 해외공고** = `cron_overseas.js`, `overseas_*` 테이블, 별도 수신자·스케줄·캐시(`_ncs_data/overseas_classify_cache.json`, git ignored).
- 둘이 공유하는 건 나라장터 검색 함수 `g2bApi.callSearchApi` 하나뿐. 테이블·프롬프트·메일 템플릿은 섞지 않는다.

---

## 📌 해외 공고 크롤링 (v4) — 빠른 참조

- 참고자료·계획서·테스트: `docs/해외공고_참고자료/` (기획 엑셀 2종, INBA 조사 PDF, 현황/요약 엑셀, v4 계획 md, 테스트 스크립트+결과 JSON)
- **흐름**: 활성 소스 수집 → `(source, notice_key)` 신규만 INSERT → **판별** → A·B 만 **요약** → 메일 [A]→[B] 섹션 → `overseas_cron_runs`
- **판별 (`lib/overseasClassify.js`)**: ① 규칙 A — 제목이 `THAI_RULE_RE`(태국·방콕·태국 도시·THAIFEX·BITEC 등) 매칭이면 GPT 없이 확정 (GPT 장애에도 발송 보장)
  ② GPT(gpt-4.1-mini, 제목+기관 60건 배치, 제목 캐시) — B(동남아·아세안·ASEAN·메콩 권역, 국가목록에 태국 빠지면 X) / X(국가 미명시 일반 해외사업·타 지역·단어 우연). + `notice_type`(용역/모집/채용/안내) + `topic`.
  GPT 미판정(키 없음·장애)은 놓치지 않도록 A 와 같이 발송.
- **요약 (`lib/overseasSummarize.js`)**: g2b 는 검색 행의 마감(`pbancPstgDt` 괄호)·금액(`prspPrce`/`alotBgtAmt`) 그대로. 나머지 소스는 상세 페이지 본문 → GPT `{deadline, amount, topic, summary, contact}`.
  금액은 첨부(HWP/PDF)에만 있는 경우가 많아 null 흔함 → 첨부 텍스트 추출은 2단계(미구현). `ddayOf()` 로 KST 기준 D-day.
- **검색 키워드 (`SEARCH_KEYWORDS`)**: `태국 방콕 치앙마이 푸켓 파타야 THAIFEX 동남아 아세안 ASEAN 메콩` — g2b·aT·기업마당·KTO 에서 사용.
  g2b 검색은 공백·대소문자 무시 부분일치라 영문 짧은 토큰은 오탐(`Thai`→`With AI`) → 제외. `한국관`(172건 중 5)·`바이어`·`수출상담회`·`임팩트`·`K-푸드` 는 1년치 테스트에서 태국 건 기여 0 → 제외.
- **소스 11개** (`overseas_sources.source_key`):
  - `g2b` **신규** — `callSearchApi(kw, 100, days_back)` × 키워드 10개. 링크 `https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=…&bidPbancOrd=…`
  - `suhyup` `koipa` `kotra` — **키워드 없이** 게시판 첫 페이지 전체 → GPT 판별 (v3 은 키워드 검색)
  - `at` `bizinfo` — 키워드 검색 유지, 키워드 10개로 확장
  - `kcca` `kec` — 전체 수집 (그대로). `kcca` `kec` `kotra` 는 **태국 소재 기관 게시판 → 규칙 A** (`SOURCE_HINT.branchThai`)
  - `kofice` `kocca` `gbsa` **v4.1 신규** (재조사 엑셀 S등급) — 입찰공고/지원공고+사업공고/입찰정보 첫 페이지 전체 → GPT 판별.
    KOFICE 상세는 GET `view.do?…&bbsSn=`, KOCCA 지원공고는 접수기간 끝을 deadline 으로, 날짜 `26.09.15` 형식은 `normDate` 가 20yy 로.
    SBA(ASP.NET 동적)·중진공(로그인 벽)은 파서 없이 나라장터 채널로 커버.
  - `kto` — **삭제** (2026-09-16, 서버 IP 차단 → 사용자 결정). `migrate_overseas.mjs` 가 행을 지움.
  - 판별 힌트 `cron_overseas.js SOURCE_HINT`: 본사 공용 게시판(수협·KOIPA·KOFICE·KOCCA·GBSA·기업마당·aT)은 지사명 대신 본사명을 GPT 에 줌 — 지사명("방콕지사")을 주면 국내 공고까지 A/B 로 오판(2026-09-16 실제 발생)
- **스케줄**: 하루 2회 — `overseas_cron_settings.hour/minute`(오전, 09:55) + `hour2/minute2/enabled2`(오후, 15:00). `index.js` `tickOverseas` 슬롯별 가드, 부팅 시 슬롯 시각 이후 실행 기록으로 재수화.
- **메일**: 발신명 "해외공고 크롤러"(`sendReport({fromName})`), 제목 `[해외공고] 태국 N건 · 동남아·아세안 M건 — 날짜`. 행마다 D-day 배지(D-7 이내 주황)·기관·제목(형광펜)·유형·금액·주제·요약. 마감 임박순.
  컷오프 `--mail-since=YYYY-MM-DD` > `OVERSEAS_POSTED_FROM` > `2026-01-01`.
- **CLI**: `node cron_overseas.js` / `--days=365 --only=g2b --mail-since=…`(백필) / `--no-mail` / `--only=a,b`
- **DB (v4 추가, `migrate_overseas.mjs` 멱등)**: `overseas_notices.grade, notice_type, topic, amount, ai_reason` (+`deadline`, `summary_md` 활용) · `overseas_cron_settings.hour2, minute2, enabled2`
- **UI**: 공고 목록 — 등급 필터(A+B 기본)·유형·금액·마감 D-day / 상세 — 등급·판별근거·금액 / 스케줄 — 오전·오후 실행 시각
- **1년치 테스트(2026-09-16, g2b 609건)**: A 41(재현율 100%) · B 106 · X 462 → 월 A 3.4건 · B 9건. 제목 판별 비용 ≈ $0.02/609건.
- **다음 단계 후보**: 첨부 텍스트 추출(금액 정확도) · `regrade_overseas.mjs` 로 재판별 (`--null` / `--since=` / `--force` / `--reset-mail`)

---

## 📌 해외 공고 크롤링 (v3) — 구조 참조 (v4 에서 판별·요약·스케줄이 바뀜, 아래 소스 파서 메모는 유효)

---

- 원본 기획: `공공기관 방콕지사 리스트업.xlsx` 의 '방법' 열 4곳. 게시판 첫 페이지 diff 방식 (days_back 미사용).
- **테이블**: `overseas_sources` (기관·on/off·last_status) / `overseas_notices` (source+notice_key 유니크) /
  `overseas_recipients` / `overseas_cron_settings` (단일행) / `overseas_cron_runs` — 전부 g2b 채용 크롤러와 별개.
- **검색 키워드 (공통)**: `태국`, `방콕`, `bangkok`, `thailand` — `lib/overseasCrawl.js` 의 `KEYWORDS`.
- **소스 8개** (`overseas_sources.source_key` = `lib/overseasCrawl.js` 파서):
  - `kcca` 주태국 한국문화원 — 302+쿠키 후 목록 GET, `tr.bbsList` `seq` → `/read/{seq}`
  - `kec` 태국한국교육원 — 공지 게시판. **인증서 체인 불완전 → node:https rejectUnauthorized=false 로만 접근**
  - `koipa` 한국지식재산보호원 — menu_cd 000041/000042 × 키워드 GET, `pageviewform('num')` → brdDetail
  - `bizinfo` 기업마당 — 지원사업명 키워드 검색, `pblancId=PBLN_...` → selectSIIA200Detail
  - `kto` 한국관광공사(투어라즈) — `/publicTenderList` 2탭(ktoip·other) + `/announcementList`.
    ⚠️ 공고·공모의 `pssrpSeqEnc` 는 목록 렌더마다 재암호화돼 매 크롤 값이 달라짐(링크는 계속 유효) →
    noticeKey 를 `제목+등록일` sha1(`contentKey`)로 잡아야 중복 저장/중복 메일이 안 생김.
  - `suhyup` 수협중앙회 방콕무역지원센터 — `/bbs/suhyup/23/artclList.do?srchColumn=sj` 제목 검색
  - `at` aT 방콕지사 (enjoykfood) — **https 가 자가서명 인증서 → http 로 접근**, `search_target=title_content`
  - `kotra` KOTRA 방콕무역관 — ajax POST `selectBmBizKbcListAjax.do` (appl_biz_dept_cd=9101).
    검색어 하이라이트를 `&lt;!HS&gt;` 로 이스케이프해 보내므로 엔티티 복원 **후** 제거 필요.
- **크론**: `cron_overseas.js` — 활성 소스 순회 → 신규만 INSERT IGNORE → 신규 있으면 기관별 그룹 HTML 메일.
  스케줄러는 index.js 인프로세스 (tickOverseas, g2b tick 과 독립 가드). 시드: 11:30 KST, enabled=0.
- **API**: `/api/admin/overseas/` — notices, recipients CRUD, cron-settings(+run-now), cron-runs, sources(+PATCH enabled)
- **메일**: 기관별 그룹 · 게시일 최신순(기관끼리도 최신 공고 있는 곳부터, 날짜 없는 건 맨 뒤) ·
  제목의 KEYWORDS 를 형광펜 처리(`highlight()` — 반드시 `esc()` 이후 적용).
- **UI**: drawer '해외 공고 크롤링' — 공고 목록 / 수신자 관리 / 스케줄 설정 (기관별 on/off + 실행 로그 포함)
- **페이지네이션**: `client/src/components/Pagination.jsx` (`usePagination` + `<Pagination>`), 20건/페이지.
  전체를 받아와 클라이언트에서 자름 (검색 필터와 함께 동작). 해외·나라장터 공고 목록 both. API limit 상한 5000.
- **수신자 관리 (공통)**: g2b·해외 모두 자유 입력 대신 `bid_employees` 활성+email 있는 직원 셀렉트로 추가.
  직원 email 은 메일플러그 아이디@insabr.kr 규칙 (2026-07-20 일괄 백필, 22명 중 20명).
- ⚠️ 메일플러그 SMTP 는 **앱 비밀번호** 사용 (2026-07 외부 클라이언트 정책 변경). `.env` EMAIL_PASS = 앱 비밀번호.

---

## 📌 출퇴근 관리 — 빠른 참조

### 지각 판단 룰 v1 (최종)

상세: `출퇴근관리/룰/rule_v1.md` · 구현: `server/lib/attendanceLateness.js`

- **크롤 시각**: 17:00 (EOD 1회)
- **출근 인정**: `check_in_time ≤ 09:30:59`
- **평가 우선순위**: 휴가 → 근무유형 → 출근내역
- **무시 카테고리**: 재택근무(D, E), 연장근로(I) — items 에서 제거
- **주말 / 공휴일 스킵**: 토/일 + `holidays` 테이블 등록일 = 평가 X (`is_late = NULL`)
- **카테고리 코드 A~O**: `memory/attendance_category_codes.md`

**케이스 트리** (먼저 매칭되는 룰 적용):
- `(0-1)` 휴가류(C/F/M/N/O + 연차/여름방학/병가) → 무조건 통과
- `(0-2)` 오전반차 + 오후반차 → 통과
- `(7)` J + L + 외근/출장 / `(11)` K + L + 외근/출장 → 통과
- `(1)` 반의반차 단독: 09:30~11:30 → 11:30:59 출근 / 그 외 → 09:30:59
- `(2)` 반의반차(09:30~11:30) + 외근/출장: D → 통과 / T → start ≤ 12:00 통과 / 초과 시 11:30:59 출근
- `(3=9)` 반의반차(09:30~11:30) + 오후반차 → 11:30:59 / `(10)` 그 외 → 09:30:59
- `(5)` 오전반차 + 반의반차(14:00~16:00) → 16:00:59 / `(6)` 그 외 → 14:00:59
- `(4)` 오전반차 + 외근/출장: 출근 ≤ 14:00:59 통과 / 없으면 D → 통과 / T → start ≤ 14:00 통과 / 초과 시 14:00:59
- `(8)` 오후반차 + 외근/출장: 출근 ≤ 09:30:59 통과 / 없으면 D → 통과 / T → start ≤ 10:00 통과 / 초과 시 09:30:59
- `(12)` 외근/출장만: D → 통과 / T → start ≤ 10:00 통과 / 초과 시 09:30:59
- `(13)` 다 없음 → 09:30:59

### 카테고리 코드 (A~O)

| 코드 | 카테고리 | 비고 |
|---|---|---|
| A | 출장(date) | 무조건 통과 (단독·조합) |
| B | 출장(time) | case 분기 |
| C | 종일 | 무조건 통과 |
| D | 재택(time) | **무시** |
| E | 재택(date) | **무시** |
| F | 유급기타휴가 | 무조건 통과 |
| G | 외근(time) | case 분기 |
| H | 외근(date) | 무조건 통과 |
| I | 연장근로 | **무시** |
| J | 반차 AM | cover 09:30~14:00 |
| K | 반차 PM | cover 13:00~18:00 (금 17:00) |
| L | 반의반차 | item start~end |
| M | 무급기타휴가 | 무조건 통과 |
| N | 경조휴가 | 무조건 통과 |
| O | 겨울방학 | 무조건 통과 |

> 실데이터 0건이지만 정의된 카테고리: 연차, 여름방학, 병가 (모두 0-1 무조건 통과).

---

## 📌 (구) TODO — 내일 할 일 (2026-05-19) [해결됨]

> 아래 초안은 v2 에서 모두 구현됨. 보존용 기록.

크롤 시각: **09:32 AM** (정시 + 약간 버퍼). `attendance_records` 단위로 `is_late` 판단.

**1. `check_in_time` 값이 있는 경우**
- 크롤이 09:32 시점이라 `check_in_time` 이 잡히는 행은 사실상 **09:31:00 ~ 09:32 사이** 출근 케이스
- **09:30:59 까지** → 통과 (즉시)
- **09:31:00 이후**:
  - `attendance_status_items` **없음** → **지각 확정**
  - `attendance_status_items` **있음** → **Rule 2 평가** → 통과 사유 있으면 통과, 없으면 지각

**2. `check_in_time` 값이 비어있는 경우 — `attendance_status_items` 보고 판단**
- 기본: 시간 범위 있는 item 들을 **시작 시간 빠른 순으로 정렬**
- **Rule 1 (휴가 류)**:
  - `반의반차` — 휴가 기간이 **09:30 포함**이면 통과
    (예: `09:30 AM ~ 11:30 AM` → 통과 / `10:00 AM ~ 12:00 PM` → 지각? **미정**)
  - `반차` AM (오전반차) — 통과
  - `종일` — 통과
- **Rule 2 (외근)**:
  - 시작 시간이 **10:00 AM 포함 이전**이면 통과
    (예: `외근 10:00 AM ~ ...` → 통과, `외근 10:01 AM ~ ...` → 지각)

**미정 — 결정 필요 (`근무상태_분석.xlsx` 참고해서 정함)**
- 반차 PM (오후반차) — 오전 출근 필요? → 지각? 통과?
- 반의반차 (09:30 미포함, 예: `10:00 AM ~ 12:00 PM`) — 지각? 시작 시간 룰?
- 출장 (시간/날짜 범위) — 외근과 같은 룰? 더 너그럽게?
- 재택근무 (시간/날짜 범위) — 시작 시간 룰? 오늘이 재택기간이면 무조건 통과?
- 연장근로 (단독) — 보통 정상출근 후라 단독은 드물지만 — 지각?
- 겨울방학 / 여름방학 / 경조휴가 / 유급·무급 기타휴가 / 병가 / 연차 — 모두 통과로 가정?
- 복합 케이스 처리: **OR 조합** (하나라도 통과 사유면 통과) 으로 갈지 확정
- 날짜 범위 처리: 오늘이 그 기간 내면 시간 무관 통과로 갈지
- `근무지 외 출근/퇴근` 컬럼 활용 여부 — 값 있으면 출근시간 비어도 정상?
- 메일플러그 자체 `commute_status` (정상/결근/지각/...) 와의 관계 — 신뢰 vs 자체 판단

**참고 데이터**
- `C:\Users\alsxo\Downloads\근무상태_분석.xlsx`
  - 시트1: 카테고리 시그니처 (15종, 시간/지속 분포)
  - 시트2: sub-item raw unique (422종) + 샘플 원본 셀
  - 시트3: 복합 조합 (22종) + 샘플
  - 시트4: 출퇴근 상태 분포 (참고)
- 데이터 기간: 2024-10-01 ~ 2026-04-24 (8496행, 2438행이 work_status 있음, 164행이 복합)

**구현 위치 예상**
- 새 모듈 `server/lib/attendanceLateness.js` — `judgeLate(record, items, threshold)` 함수
- crawler 후 또는 별도 cron 으로 평가 → `attendance_records.is_late` 컬럼 추가 또는 별도 평가 테이블

---

매일 1회(KST, 기본 11:00) 나라장터(g2b.go.kr)에서 최근 5일치 "채용" 키워드 입찰공고를 자동 수집하고, GPT로 채용대행 여부 판단·핵심 정보 요약 후 등록된 수신자에게 메일 발송. 관리자 페이지에서 보관 공고 조회·수신자 관리·**스케줄 설정**·수동 크롤링 가능. 실행 시각/검색 윈도우는 DB `cron_settings` 단일행으로 관리한다.

---

## 1. 핵심 흐름

```
[매일 hh:mm KST — DB cron_settings 단일행]  Express 인프로세스 스케줄러 (1분 tick)
        ↓
[crawl/cron.js — DB days_back (기본 5일) 윈도우 sliding]
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
| 스케줄러 | Express 인프로세스 1분 tick (DB `cron_settings` 읽음) — 기존 systemd timer 대체 |

---

## 3. 디렉토리 구조

```
narajangteo/
├── server/
│   ├── index.js                ← Express 엔트리 (port 3001)
│   ├── cron.js                 ← 일일 자동 실행 (--days=5)
│   ├── migrate.js              ← RDS 스키마 적용 (g2b 채용)
│   ├── migrate_attendance.mjs  ← 출퇴근 컬럼 + holidays 테이블 + 시드 (멱등)
│   ├── recipients.js           ← 수신자 CLI (테스트용)
│   ├── schema.sql              ← MySQL 스키마 (g2b 채용)
│   ├── .env                    ← 환경변수 (git ignored)
│   ├── data/files/             ← 첨부 디스크 저장소 (런타임 생성, git ignored)
│   ├── _backfill_attendance.mjs ← 출퇴근 raw xls 일자별 백필 (createAttendanceSnapshot 직접 호출)
│   ├── _recompute.mjs          ← 모든 record judgeV1 재계산 (holidays 변경 후)
│   ├── _test_lateness_v1.mjs   ← judgeV1 historical 검증
│   └── lib/
│       ├── auth.js             ← LOGIN_KEY 인증 + 쿠키
│       ├── db.js               ← mysql2 풀 + 모든 헬퍼 (notices/employees/attendance/holidays/report)
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
│       ├── email.js            ← nodemailer 메일플러그
│       ├── attendanceCrawler.js  ← 메일플러그 쿠키 자동 크롤 + 엑셀 다운로드
│       ├── attendanceParser.js   ← "근무 상태" 셀 → category/subType/timeRange items
│       └── attendanceLateness.js ← **지각 판단 룰 v1 — judgeV1()**
├── client/
│   ├── src/
│   │   ├── App.jsx             ← BrowserRouter + Protected 라우트 + drawer
│   │   ├── auth.js             ← login/check/logout + authFetch
│   │   └── pages/
│   │       ├── Login.jsx
│   │       ├── AdminDashboard.jsx        ← 통계 + 최근 cron
│   │       ├── AdminNotices.jsx          ← 보관 공고 목록 (필터·검색)
│   │       ├── AdminNoticeDetail.jsx     ← 단건 + 첨부 다운로드
│   │       ├── AdminRecipients.jsx       ← 수신자 CRUD (인라인 편집)
│   │       ├── Crawl.jsx                 ← 수동 크롤링 (기존 흐름, DB X)
│   │       ├── BidEmployee.jsx           ← 직원 CRUD + 출결대상 토글
│   │       ├── BidEmployeeDetail.jsx     ← 직원 상세
│   │       ├── BidProject.jsx            ← 유사사업
│   │       ├── BidLab.jsx                ← .hwp 템플릿 자동 작성 실험실
│   │       ├── AttendanceLab.jsx         ← 출퇴근 쿠키 등록 + 크롤 + 스냅샷 + 지각판정 인라인 수정
│   │       ├── AttendanceReport.jsx      ← **기간별 리포트 — 사람별 지각 통계 + 드릴다운 + CSV**
│   │       └── AttendanceHolidays.jsx    ← **공휴일 캘린더 (월 그리드, 클릭 등록/삭제, 재평가)**
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

-- 일일 자동 실행 스케줄 (단일행, id=1 고정)
CREATE TABLE cron_settings (
  id          TINYINT PRIMARY KEY DEFAULT 1,
  hour        TINYINT NOT NULL DEFAULT 11,   -- KST 0~23
  minute      TINYINT NOT NULL DEFAULT 0,    -- 0~59
  enabled     TINYINT(1) NOT NULL DEFAULT 1,
  days_back   INT NOT NULL DEFAULT 5,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
-- seed: 11:00 KST, 5일 윈도우

-- ─── 출퇴근 관리 (v2) ───
-- bid_employees: attendance_target 컬럼 추가 (디폴트 1)

CREATE TABLE attendance_snapshots (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  captured_at     DATETIME NOT NULL,         -- 크롤 시각 (보통 17:00)
  row_count       INT NOT NULL,
  excel_filename  VARCHAR(255),
  note            TEXT,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE attendance_records (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  snapshot_id        INT NOT NULL,
  employee_id        INT,                    -- bid_employees.id (매칭된 경우)
  row_index          INT,
  date               VARCHAR(50),            -- "YYYY-MM-DD (요일)"
  name               VARCHAR(100),
  emp_no             VARCHAR(50),
  dept, position, work_type, check_in_time, check_in_outside,
  check_out_time, check_out_outside, commute_status, work_status,
  -- v2 지각 판정 컬럼 (migrate_attendance.mjs 가 ALTER 로 추가)
  is_late          TINYINT(1),               -- 0=통과 / 1=지각 / NULL=주말·공휴일 skip
  late_case_id     VARCHAR(30),              -- '4-2-2-2' / 'L_solo_0930' / 'weekend' / 'holiday' / ...
  late_reason      TEXT,
  late_deadline    VARCHAR(20),              -- "11:30:59" 등
  manual_override  TINYINT(1) DEFAULT 0,     -- 1 이면 사용자 수정 — 재평가 시 보존
  manual_note      TEXT,
  FOREIGN KEY (snapshot_id) REFERENCES attendance_snapshots(id) ON DELETE CASCADE,
  INDEX idx_is_late (is_late)
);

CREATE TABLE attendance_status_items (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  record_id       INT NOT NULL,
  item_index      INT,
  category        VARCHAR(50),              -- 외근/출장/반차/반의반차/...
  sub_type        VARCHAR(20),              -- AM/PM (반차)
  range_type      VARCHAR(20),              -- time/date
  start_time, end_time, start_date, end_date,
  duration_minutes INT,
  raw             TEXT,
  FOREIGN KEY (record_id) REFERENCES attendance_records(id) ON DELETE CASCADE
);

CREATE TABLE holidays (
  date       DATE PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  source     VARCHAR(50) DEFAULT 'manual',  -- 'kr_default' / 'manual'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
-- seed: 33건 (2024~2026 KR 공휴일 + 근로자의날). migrate_attendance.mjs 가 INSERT IGNORE.

-- (기존) app_secrets — 메일플러그 쿠키 등
CREATE TABLE app_secrets (
  k VARCHAR(100) PRIMARY KEY,
  v MEDIUMTEXT,
  note TEXT,
  updated_at DATETIME,
  last_used_at DATETIME
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
- `GET  /api/admin/cron-settings` — `{hour, minute, enabled, days_back, next_run_at}`
- `PATCH /api/admin/cron-settings` — `{hour?, minute?, enabled?, days_back?}`
- `POST /api/admin/cron-settings/run-now` — cron.js 즉시 발화 (백그라운드 spawn)

### Admin — 입찰
- `GET /api/admin/bid-employees` · `POST` · `PATCH /:id` · `DELETE /:id` · `GET /:id/full`
- 학력/경력/자격증 nested CRUD: `/:empId/{educations,careers,certifications}`
- `GET /api/admin/bid-projects` · POST · PATCH · DELETE 등
- `POST /api/admin/lab/parse` — .hwp 업로드 → 페이지 추출 (세션 캐시)
- `POST /api/admin/lab/replicate-bulk` → 폴링 (`GET /:jobId`, `GET /:jobId/download`)

### Admin — 출퇴근 관리 (v2)
- `GET  /api/admin/attendance/cookies` — 메일플러그 쿠키 상태
- `POST /api/admin/attendance/cookies` — 쿠키 저장
- `POST /api/admin/attendance/crawl` — 크롤 실행 (createAttendanceSnapshot — 판정 자동 저장)
- `GET  /api/admin/attendance/snapshots?limit=` — 스냅샷 목록
- `GET  /api/admin/attendance/snapshots/:id` — 단건 + records + items (판정 포함)
- `DELETE /api/admin/attendance/snapshots/:id`
- `PATCH /api/admin/attendance/records/:id` — `{is_late?, manual_note?, reset?}` (수동 수정 / 재계산)
- `GET  /api/admin/attendance/report?from=YYYY-MM-DD&to=YYYY-MM-DD` — 기간 리포트 (사람별 + 일자별 + 케이스 분포)
- `POST /api/admin/attendance/recompute` — manual_override=0 인 전체 record judgeV1 재계산 (holidays 변경 후 사용)
- `GET  /api/admin/holidays` · `POST` · `DELETE /:date` — 공휴일 캘린더 CRUD

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
/etc/systemd/system/g2b-api.service     ← Express 데몬 (Restart=on-failure) — 인프로세스 스케줄러 포함
```

> ⚠️ 기존 `g2b-daily.service` / `g2b-daily.timer` 는 v1.1 부터 사용하지 않습니다.
> 운영 환경에서는 반드시 비활성화하세요:
> ```
> sudo systemctl disable --now g2b-daily.timer
> sudo systemctl disable --now g2b-daily.service
> ```
> 스케줄은 어드민 → "스케줄 설정" 또는 DB `cron_settings` 단일행에서 관리.

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
node migrate.js                         # g2b 채용 스키마 (1회)
node migrate_attendance.mjs             # 출퇴근 컬럼/holidays/시드 — v2부터 (멱등, 안전)
cd ../client && npm run build           # 프론트 변경 시
sudo systemctl restart g2b-api          # API 재시작 (스케줄러 포함)

# 수동 cron 실행
cd /opt/g2b/server && node cron.js                # DB days_back 사용
cd /opt/g2b/server && node cron.js --days=7       # override
# 또는 어드민 → 스케줄 설정 → "지금 실행"

# 상태 확인
systemctl status g2b-api
tail -f /var/log/g2b/api.log            # 스케줄러 로그 ([cron-scheduler] ...)
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
