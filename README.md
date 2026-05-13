# 나라장터 '채용' 입찰공고 크롤러

브라우저에서 ▶ 실행 누르면 헤드리스로 g2b.go.kr 검색 API를 직접 호출해서
'채용' 키워드로 최근 30일 용역 공고 100건을 가져오고 **실제 직원채용 / 기타**로 자동 분류합니다.

## 구조

```
나라장터크롤링/
├── server/          # FastAPI + Playwright(쿠키만) + httpx
│   ├── main.py      # /api/crawl 엔드포인트
│   └── _debug/      # 응답 덤프
├── client/          # Vite + React
│   ├── package.json
│   ├── vite.config.js   (/api → 3001 proxy)
│   └── src/
└── run.bat          # 둘 다 띄우는 단축 실행기
```

## 한 번만 — 의존성 설치

```powershell
# 백엔드 (이미 깔려있을 가능성 높음)
pip install fastapi uvicorn playwright httpx
python -m playwright install chromium

# 프론트엔드
cd client
npm install
```

## 실행

**가장 빠른 방법:** 폴더의 `run.bat` 더블클릭 → 두 cmd 창이 뜨고, 브라우저에서 http://localhost:5173 접속.

**수동 실행:**

```powershell
# 터미널 1
cd server
python main.py

# 터미널 2
cd client
npm run dev
```

브라우저: <http://localhost:5173>

## 동작 원리

1. **세션 쿠키 1회 수집** — Playwright 헤드리스로 g2b.go.kr 한번 방문해서 JSESSIONID 등 받음
2. **API 직접 호출** — `POST /pn/pnp/pnpe/BidPbac/selectBidPbacScrollTypeList.do` 에 검색 페이로드 던짐
3. **분류** — 공고명 정규식으로 시스템/박람회/교육/조사 제외, 그 외 "채용" 포함은 실제 채용으로
4. **표시** — 두 섹션으로 분리해서 표 형식

쿠키는 백엔드 메모리에 캐시되고, 401/403 받으면 자동 재발급.

## 분류 기준

**기타로 분류 (실제 채용 아님)**
- 채용시스템 / 채용 전산 시스템 / 채용 접수관리 / 통합역량검사 시스템
- 채용박람회 / 취업·채용 박람회
- 채용연계형 경진대회
- 채용자 교육 / 신규 채용자 교육
- 채용 활성화 프로젝트 (홍보/캠페인)
- 채용 관련 조사 용역

**실제 채용**
- 공고명에 "채용" 포함 + 위 제외 패턴에 안 걸리는 것 전부
  (직원 채용대행/위탁, 직접 채용공고, 자체채용 등)

`server/main.py`의 `EXCLUDE_PATTERNS` 수정해서 룰 조정 가능.

## 트러블슈팅

- **HTTP 500** — 쿠키 만료. `POST /api/refresh-session` 호출하거나 백엔드 재시작.
- **결과가 0건** — 검색 기간 안에 공고가 없는 경우. `build_payload`의 `days_back` 늘리기.
- **응답 구조 변경** — `server/_debug/search_response.txt` 에 원본 응답 덤프됨. 키 이름 확인.
