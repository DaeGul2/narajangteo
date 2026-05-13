"""
나라장터(g2b.go.kr) '채용' 입찰공고 크롤러 백엔드.
- 헤드리스 Playwright로 세션 쿠키만 받고
- 실제 검색 API(/pn/pnp/pnpe/BidPbac/selectBidPbacScrollTypeList.do)를 직접 호출
- 공고명 기반 실제 직원채용 여부 분류
- /api/crawl 엔드포인트
"""

from __future__ import annotations

import html
import io
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any


def _clean(v: Any) -> str:
    """HTML 엔티티 디코딩 + strip."""
    if v is None:
        return ""
    return html.unescape(str(v)).strip()


def _normalize_bid_no(v: Any) -> str:
    """입찰공고번호 정규화: 모든 공백 제거 (예: 'R26BK01480852 - 000' → 'R26BK01480852-000')."""
    s = _clean(v)
    return re.sub(r"\s+", "", s)


def _money(v: Any) -> str:
    """금액 포맷팅: 1234567 → '1,234,567원'."""
    s = _clean(v)
    if not s:
        return ""
    # 숫자만 추출
    digits = re.sub(r"[^\d]", "", s)
    if not digits:
        return s
    try:
        return f"{int(digits):,}원"
    except ValueError:
        return s

import asyncio
import base64
import io as _io
import os
import zipfile
import zlib
from urllib.parse import quote

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from playwright.async_api import async_playwright, TimeoutError as PWTimeout

# .env 로드
load_dotenv(Path(__file__).parent / ".env")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")

# Windows 콘솔 UTF-8 강제
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")


def _log(msg: str) -> None:
    print(msg, flush=True)


DEBUG_DIR = Path(__file__).parent / "_debug"
DEBUG_DIR.mkdir(exist_ok=True)


app = FastAPI(title="g2b crawler")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─────────────────────────────────────────────────────────────
# 분류 로직: 공고명에서 실제 직원채용 여부 판별
# ─────────────────────────────────────────────────────────────
EXCLUDE_PATTERNS: list[tuple[str, str]] = [
    (r"채용\s*전산\s*시스템", "채용 시스템"),
    (r"채용\s*시스템", "채용 시스템"),
    (r"채용시스템", "채용 시스템"),
    (r"채용\s*박람회", "박람회"),
    (r"채용박람회", "박람회"),
    (r"취업.*채용.*박람회", "박람회"),
    (r"외국인.*취업.*채용", "박람회"),
    (r"채용연계형", "경진대회/연계행사"),
    (r"채용자\s*교육", "신규자 교육"),
    (r"신규\s*채용자\s*교육", "신규자 교육"),
    (r"채용에\s*대한\s*조사", "조사 용역"),
    (r"AI.*채용.*조사", "조사 용역"),
    (r"채용\s*접수관리", "시스템 운영"),
    (r"통합역량검사", "시스템 임대"),
    (r"채용\s*활성화.*프로젝트", "홍보/캠페인"),
    (r"채용\s*및\s*통합역량검사", "시스템 임대"),
    (r"온라인\s*채용.*시스템", "시스템 임대"),
]


def classify(name: str) -> tuple[bool, str]:
    """공고명 분류 → (실제채용여부, 사유)"""
    if not name:
        return False, "공고명 없음"
    for pat, reason in EXCLUDE_PATTERNS:
        if re.search(pat, name):
            return False, reason
    if "채용" in name:
        return True, "직접/대행 채용"
    return False, "해당 없음"


# ─────────────────────────────────────────────────────────────
# 1) Playwright로 세션 쿠키 1회 수집
# ─────────────────────────────────────────────────────────────
_cached_cookies: dict[str, str] | None = None


async def get_session_cookies(force: bool = False) -> dict[str, str]:
    global _cached_cookies
    if _cached_cookies and not force:
        return _cached_cookies

    _log("[cookie] 헤드리스 브라우저로 g2b.go.kr 방문하여 세션 쿠키 수집")
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-dev-shm-usage",
            ],
        )
        ctx = await browser.new_context(
            viewport={"width": 1600, "height": 1000},
            locale="ko-KR",
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
        )
        await ctx.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });"
        )
        page = await ctx.new_page()
        try:
            await page.goto(
                "https://www.g2b.go.kr/",
                wait_until="domcontentloaded",
                timeout=60_000,
            )
            try:
                await page.wait_for_load_state("networkidle", timeout=20_000)
            except PWTimeout:
                pass
            await page.wait_for_timeout(3000)
            cookies = await ctx.cookies()
        finally:
            await browser.close()

    cookie_dict = {c["name"]: c["value"] for c in cookies}
    _log(f"[cookie] 수집된 쿠키 {len(cookie_dict)}개: {list(cookie_dict.keys())}")
    _cached_cookies = cookie_dict
    return cookie_dict


# ─────────────────────────────────────────────────────────────
# 2) 검색 API 직접 호출
# ─────────────────────────────────────────────────────────────
SEARCH_URL = "https://www.g2b.go.kr/pn/pnp/pnpe/BidPbac/selectBidPbacScrollTypeList.do"

DEFAULT_HEADERS = {
    "Accept": "application/json",
    "Accept-Language": "ko,en-US;q=0.9,en;q=0.8",
    "Content-Type": "application/json;charset=UTF-8",
    "Origin": "https://www.g2b.go.kr",
    "Referer": "https://www.g2b.go.kr/",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Menu-Info": (
        '{"menuNo":"01175","menuCangVal":"PNPE001_01",'
        '"bsneClsfCd":"%EC%97%85130026","scrnNo":"00941"}'
    ),
    "Target-Id": "btnS0004",
    "submissionid": "mf_wfm_container_tacBidPbancLst_contents_tab2_body_sbmPbancBidPbancLst",
    "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not_A Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
}


def build_payload(
    keyword: str,
    count: int,
    days_back: int,
) -> dict[str, Any]:
    today = datetime.now()
    to_dt = today.strftime("%Y%m%d")
    from_dt = (today - timedelta(days=days_back)).strftime("%Y%m%d")
    return {
        "dlBidPbancLstM": {
            "untyBidPbancNo": "",
            "bidPbancNo": "",
            "bidPbancOrd": "",
            "prcmBsneUntyNoOrd": "",
            # 용역 비즈니스 구분 (사용자 cURL에서 그대로)
            "prcmBsneSeCd": "0000 조070001 조070002 조070003 조070004 조070005 민079999",
            "bidPbancNm": keyword,
            "pbancPstgDt": "",
            "ldocNoVal": "",
            "bidPrspPrce": "",
            "ctrtDmndRcptNo": "",
            "dmstcOvrsSeCd": "",
            "pbancKndCd": "공440002",
            "ctrtTyCd": "",
            "bidCtrtMthdCd": "",
            "scsbdMthdCd": "",
            "fromBidDt": from_dt,
            "toBidDt": to_dt,
            "minBidPrspPrce": "",
            "maxBidPrspPrce": "",
            "bsneAllYn": "Y",
            "frcpYn": "Y",
            "rsrvYn": "Y",
            "laseYn": "Y",
            "untyGrpGb": "",
            "dmstNm": "",
            "pbancPicNm": "",
            "odnLmtLgdngCd": "",
            "odnLmtLgdngNm": "",
            "intpCd": "",
            "intpNm": "",
            "dtlsPrnmNo": "",
            "dtlsPrnmNm": "",
            "slprRcptDdlnYn": "",
            "lcrtTyCd": "",
            "isMas": "",
            "isElpdt": "",
            "oderInstUntyGrpNo": "",
            "instSearchRangeYn": "",
            "esdacYn": "",
            "infoSysCd": "정010029",
            "contxtSeCd": "콘010006",
            "bidDateType": "R",
            "brcoOrgnCd": "",
            "deptOrgnCd": "",
            "isShop": "",
            "srchTy": "0",
            "cangParmVal": "",
            "currentPage": "",
            "recordCountPerPage": str(count),
            "startIndex": 1,
            "endIndex": count,
        }
    }


async def call_search_api(
    keyword: str = "채용",
    count: int = 100,
    days_back: int = 30,
    retry_on_session_expired: bool = True,
) -> list[dict[str, Any]]:
    cookies = await get_session_cookies()
    payload = build_payload(keyword, count, days_back)

    _log(f"[search] keyword={keyword!r} count={count} days={days_back}")
    async with httpx.AsyncClient(cookies=cookies, timeout=60) as client:
        r = await client.post(SEARCH_URL, json=payload, headers=DEFAULT_HEADERS)

    # 디버그: 응답 저장 (풀)
    try:
        (DEBUG_DIR / "search_response.txt").write_text(
            f"status={r.status_code}\nheaders={dict(r.headers)}\n\n{r.text}",
            encoding="utf-8",
        )
    except Exception:
        pass

    if r.status_code in (401, 403) and retry_on_session_expired:
        _log(f"[search] {r.status_code} → 세션 재발급 후 재시도")
        await get_session_cookies(force=True)
        return await call_search_api(keyword, count, days_back, retry_on_session_expired=False)

    r.raise_for_status()
    data = r.json()

    # 응답 구조 추정: dlBidPbancLstD 안에 list가 있거나, 최상위에 있을 수 있음
    candidates = [
        data.get("dlBidPbancLstD"),
        data.get("dlBidPbancLst"),
        data.get("data"),
        data.get("list"),
        data.get("rows"),
    ]
    rows = next((c for c in candidates if isinstance(c, list)), None)
    if rows is None:
        # 디버그 키 출력
        _log(f"[search] 응답 키: {list(data.keys()) if isinstance(data, dict) else type(data)}")
        if isinstance(data, dict):
            for k, v in data.items():
                if isinstance(v, list) and v:
                    _log(f"[search] '{k}' 리스트 사용 (len={len(v)})")
                    rows = v
                    break
                if isinstance(v, dict):
                    for k2, v2 in v.items():
                        if isinstance(v2, list) and v2:
                            _log(f"[search] '{k}.{k2}' 리스트 사용 (len={len(v2)})")
                            rows = v2
                            break
                    if rows:
                        break
    if rows is None:
        rows = []
    _log(f"[search] {len(rows)} 행 수신")
    return rows


# ─────────────────────────────────────────────────────────────
# 3) 디테일 API: 입찰진행정보 + 사업금액 등 추가 메타
# ─────────────────────────────────────────────────────────────
DETAIL_URL = "https://www.g2b.go.kr/pn/pnp/pnpe/ItemBidPbac/selectItemAnncMngV.do"

DETAIL_HEADERS = {
    **DEFAULT_HEADERS,
    "Menu-Info": (
        '{"menuNo":"01196","menuCangVal":"PNPE027_01",'
        '"bsneClsfCd":"%EC%97%85130026","scrnNo":"06085"}'
    ),
    "Usr-Id": "UN00000120665",
    "submissionid": "mf_wfm_container_mainWframe_selectItemAnncMngV",
}


ATCH_FILE_LIST_URL = (
    "https://www.g2b.go.kr/fs/fsc/fscb/UntyAtchFile/selectUntyAtchFileList.do"
)


async def call_atch_file_list(
    client: httpx.AsyncClient,
    unty_atch_file_no: str,
) -> list[dict[str, Any]]:
    """첨부파일 리스트 조회."""
    if not unty_atch_file_no:
        return []
    payload = {
        "dlUntyAtchFileM": {
            "untyAtchFileNo": unty_atch_file_no,
            "atchFileSqnos": "",
            "bsnePath": "PNPE",
            "bsneClsfCd": "업130026",
            "tblNm": "PBANC_BID_PBANC",
            "colNm": "ITEM_PBANC_UNTY_ATCH_FILE_NO",
            "webPathUse": "N",
            "isScanEnabled": False,
            "imgUrl": "",
            "atchFileKndCds": "",
            "ignoreAtchFileKndCds": "",
            "kbrdrIds": "",
            "kuploadId": "g2b_crawler",
            "viewMode": "view",
        }
    }
    try:
        r = await client.post(
            ATCH_FILE_LIST_URL, json=payload, headers=DETAIL_HEADERS, timeout=15
        )
        if r.status_code != 200:
            return []
        data = r.json()
    except Exception:
        return []
    rows: list[dict[str, Any]] = []
    for row in data.get("dlUntyAtchFileL") or []:
        if not isinstance(row, dict):
            continue
        rows.append(
            {
                "untyAtchFileNo": _clean(row.get("untyAtchFileNo")),
                "atchFileSqno": str(row.get("atchFileSqno") or ""),
                "orgnlAtchFileNm": _clean(row.get("orgnlAtchFileNm")),
                "fileExtnNm": _clean(row.get("fileExtnNm")),
                "fileSz": int(row.get("fileSz") or 0),
                "atchFileKndCd": _clean(row.get("atchFileKndCd")),
                "atchFileKndNm": _clean(row.get("atchFileKndNm")),
                "kbrdrNm": _clean(row.get("kbrdrNm")),
                "inptDt": _clean(row.get("inptDt")),
            }
        )
    return rows


async def call_detail_api(
    client: httpx.AsyncClient,
    bid_no: str,
    bid_ord: str,
) -> dict[str, Any]:
    """공고 디테일 호출 → 입찰진행정보 + 메인 메타 + 첨부파일 리스트 반환."""
    if not bid_no:
        return {}
    payload = {
        "dmItemMap": {
            "bidPbancNo": bid_no,
            "bidPbancOrd": bid_ord or "000",
            "scsbdMthdCd": "",
            "currentPage": 1,
            "recordCountPerPage": "",
        }
    }
    try:
        r = await client.post(DETAIL_URL, json=payload, headers=DETAIL_HEADERS, timeout=20)
        if r.status_code != 200:
            return {"_error": f"HTTP {r.status_code}"}
        data = r.json()
    except Exception as e:
        return {"_error": str(e)}

    item_map = data.get("dmItemMap") or {}
    progress_rows: list[dict[str, str]] = []
    for row in data.get("dmItemList1") or []:
        if not isinstance(row, dict):
            continue
        progress_rows.append(
            {
                "ord": _clean(row.get("ord")),
                "subject": _clean(row.get("subject")),
                "prgNm": _clean(row.get("prgNm")),
                "startDt": _clean(row.get("startDt")),
                "endDt": _clean(row.get("endDt")),
                "placNm": _clean(row.get("placNm")),
            }
        )

    # 수요기관 담당자 그리드 (dmItemList2)
    dmst_pic_rows: list[dict[str, str]] = []
    for row in data.get("dmItemList2") or []:
        if not isinstance(row, dict):
            continue
        dmst_pic_rows.append(
            {
                "dmstUntyGrpNm": _clean(row.get("dmstUntyGrpNm")),
                "deptNm": _clean(row.get("deptNm")),
                "picNm": _clean(row.get("picNm")),
                "tlphNo": _clean(row.get("tlphNo")),
                "faxNo": _clean(row.get("faxNo")),
                "eml": _clean(row.get("eml")),
                "evlPicYn": _clean(row.get("evlPicYn")),
            }
        )

    # 첨부파일 리스트
    atch_no = _clean(item_map.get("itemPbancUntyAtchFileNo"))
    files = await call_atch_file_list(client, atch_no) if atch_no else []

    return {
        "bgtAmt": _money(item_map.get("alotBgtAmt") or item_map.get("bizAmt")),
        "prspPrce": _money(item_map.get("prspPrce")),
        "vatAmt": _money(item_map.get("vatAmt")),
        "scsbdMthd": _clean(item_map.get("scsbdMthdNm")),
        "pnprMtho": _clean(item_map.get("pnprDcsnMthoNm")),
        "pbancKnd": _clean(item_map.get("pbancKndNm")),
        "progress": progress_rows,
        "dmstPic": dmst_pic_rows,
        "files": files,
        "untyAtchFileNo": atch_no,
    }


async def enrich_with_details(
    items: list[dict[str, Any]],
    concurrency: int = 8,
) -> None:
    """items의 각 행에 디테일 API 결과를 in-place로 합침."""
    cookies = await get_session_cookies()
    sem = asyncio.Semaphore(concurrency)

    async with httpx.AsyncClient(cookies=cookies, timeout=30) as client:
        async def fetch_one(item: dict) -> None:
            bid_no = item.get("_bidPbancNo") or ""
            # 공고번호에서 -000 같은 ord 분리
            ord_val = "000"
            m = re.match(r"^(.+?)-(\d+)$", bid_no)
            if m:
                bid_no_clean = m.group(1)
                ord_val = m.group(2)
            else:
                bid_no_clean = bid_no
            async with sem:
                detail = await call_detail_api(client, bid_no_clean, ord_val)
            # 검색 응답값이 비어있는 경우만 디테일로 보완
            for key in ("bgtAmt", "prspPrce", "scsbdMthd", "pnprMtho"):
                if not item.get(key) and detail.get(key):
                    item[key] = detail[key]
            item["progress"] = detail.get("progress", [])
            item["vatAmt"] = detail.get("vatAmt", "")
            item["pbancKnd"] = detail.get("pbancKnd", "")
            item["dmstPic"] = detail.get("dmstPic", [])
            item["files"] = detail.get("files", [])
            item["untyAtchFileNo"] = detail.get("untyAtchFileNo", "")

        await asyncio.gather(*(fetch_one(it) for it in items))


# ─────────────────────────────────────────────────────────────
# API
# ─────────────────────────────────────────────────────────────
@app.get("/api/health")
async def health():
    return {"ok": True}


@app.post("/api/crawl")
async def api_crawl():
    rows = await call_search_api(keyword="채용", count=100, days_back=30)

    items: list[dict[str, Any]] = []
    for idx, r in enumerate(rows, start=1):
        if not isinstance(r, dict):
            continue
        name = _clean(
            r.get("bidPbancNm") or r.get("BidPbancNm") or r.get("bidPbancNmCnts")
        )
        if not name:
            continue
        is_recruitment, reason = classify(name)
        items.append(
            {
                "no": str(idx),
                "name": name,
                "bidNo": _normalize_bid_no(
                    r.get("bidPbancUntyNoOrd")
                    or r.get("bidPbancNo")
                    or r.get("untyBidPbancNo")
                ),
                "agency": _clean(
                    r.get("oderInstUntyGrpNm")
                    or r.get("instNm")
                    or r.get("ntceInsttNm")
                ),
                "demander": _clean(r.get("dmstNm") or r.get("dminsttNm")),
                "date": _clean(
                    r.get("pbancPstgDt")
                    or r.get("bidNtceDt")
                    or r.get("ntceDate")
                ),
                "deadline": _clean(
                    r.get("bidPbancLastRcptYmd") or r.get("bidClseDt")
                ),
                "status": _clean(r.get("pbancSttsNm") or r.get("bidNtceSttusNm")),
                "category": _clean(r.get("prcmBsneSeCdNm") or r.get("bsneClsfCdNm")),
                # 신규: 금액·낙찰방법·예가방법
                "bgtAmt": _money(r.get("alotBgtAmt")),  # 배정예산 = 사업금액(추정가격+부가세)
                "prspPrce": _money(r.get("prspPrce")),  # 추정가격
                "scsbdMthd": _clean(r.get("scsbdMthdNm")),  # 낙찰방법
                "pnprMtho": _clean(r.get("pnprDcsnMthoNm")),  # 예가방법
                # 디테일 조회용 키들
                "_bidPbancUntyNo": _clean(r.get("bidPbancUntyNo")),
                "_bidPbancUntyOrd": _clean(r.get("bidPbancUntyOrd")),
                "_bidPbancNo": _clean(r.get("bidPbancNo") or r.get("bidPbancUntyNoOrd")),
                "isRecruitment": is_recruitment,
                "reason": reason,
            }
        )

    # 디테일 API로 입찰진행정보 + 추가 메타 채우기 (비동기 동시 호출)
    _log(f"[detail] {len(items)}건 디테일 API 호출")
    try:
        await enrich_with_details(items, concurrency=8)
        _log(f"[detail] 완료")
    except Exception as e:
        _log(f"[detail] 실패: {e} (디테일 없이 진행)")

    recruitment = [i for i in items if i["isRecruitment"]]
    other = [i for i in items if not i["isRecruitment"]]
    return {
        "total": len(items),
        "recruitmentCount": len(recruitment),
        "otherCount": len(other),
        "recruitment": recruitment,
        "other": other,
    }


@app.post("/api/refresh-session")
async def refresh_session():
    await get_session_cookies(force=True)
    return {"ok": True}


# ─────────────────────────────────────────────────────────────
# 파일 일괄 다운로드 (ZIP)
# ─────────────────────────────────────────────────────────────
FILE_UPLOAD_URL = "https://www.g2b.go.kr/fs/fsc/fsca/fileUpload.do"


class _FileItem(BaseModel):
    untyAtchFileNo: str = ""
    atchFileSqno: str | int = ""
    orgnlAtchFileNm: str = ""
    fileExtnNm: str = ""
    fileSz: int = 0
    atchFileKndCd: str = ""
    atchFileKndNm: str = ""
    kbrdrNm: str = ""
    inptDt: str = ""


class _ZipReq(BaseModel):
    bidNo: str = ""
    name: str = ""
    untyAtchFileNo: str = ""
    files: list[_FileItem] = []


async def _automate_download(bid_no: str, bid_name: str) -> tuple[list[dict], list[str]]:
    """
    풀 자동화: Playwright로 g2b 메인 → 검색 → 공고 클릭 → 첨부 클릭 흐름 수행.
    각 첨부 클릭 시 fileUpload.do로 발생하는 4개 요청의 body(k01)를 가로채고,
    httpx로 그 body를 그대로 POST하여 binary 응답(=실제 파일)만 추려서 반환.

    Returns: ([{name, bytes}, ...], [log lines])
    """
    bodies: list[str] = []
    cookies: dict[str, str] = {}
    log: list[str] = []

    def D(m: str) -> None:
        line = f"[zip] {m}"
        _log(line)
        log.append(line)

    try:
        async with async_playwright() as pw:
            D(f"Playwright launch — bidNo={bid_no!r} name={bid_name!r}")
            browser = await pw.chromium.launch(headless=True)
            ctx = await browser.new_context(
                viewport={"width": 1600, "height": 1000},
                locale="ko-KR",
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
                ),
            )
            page = await ctx.new_page()

            def on_request(req):
                try:
                    if "fileUpload.do" not in req.url or "?raonk=" in req.url:
                        return
                    body = req.post_data or ""
                    if body.startswith("k01="):
                        bodies.append(body)
                except Exception:
                    pass

            page.on("request", on_request)

            try:
                # 1) 메인 진입
                await page.goto("https://www.g2b.go.kr/", wait_until="domcontentloaded", timeout=60_000)
                try:
                    await page.wait_for_load_state("networkidle", timeout=15_000)
                except PWTimeout:
                    pass
                await page.wait_for_timeout(4000)

                # 2) 메인 영역 검색 input 찾기 (GNB 통합검색 제외)
                search_sel = await page.evaluate(
                    """
                    () => {
                      const cand = Array.from(document.querySelectorAll('input[type=text]'));
                      for (const el of cand) {
                        const r = el.getBoundingClientRect();
                        const vis = r.width > 100 && r.height > 16 && el.offsetParent !== null;
                        if (vis && (el.placeholder||'').trim() === '입찰공고') return '#' + el.id;
                      }
                      for (const el of cand) {
                        const r = el.getBoundingClientRect();
                        const vis = r.width > 100 && r.height > 16 && el.offsetParent !== null;
                        if (vis && (el.placeholder||'').includes('입찰공고')) return '#' + el.id;
                      }
                      return null;
                    }
                    """
                )
                if not search_sel:
                    raise RuntimeError("검색 input 발견 실패")
                D(f"검색 input: {search_sel}")

                # 3) 검색 키워드 — 공고명 우선(정확도↑), 폴백으로 공고번호
                keyword = (bid_name or "").strip() or (bid_no or "").split("-")[0]
                if not keyword:
                    raise RuntimeError("검색 키워드 없음")
                await page.fill(search_sel, keyword)
                await page.press(search_sel, "Enter")
                await page.wait_for_timeout(7000)
                D(f"검색 완료 (keyword={keyword!r})")

                # 4) 결과 행 클릭 — 폴백 chain: 공고명 첫 단어 → bidNo → 검색 결과 첫 데이터 셀
                click_candidates: list[str] = []
                if bid_name:
                    parts = bid_name.split()
                    if parts:
                        click_candidates.append(parts[0])  # ex) "2026년"
                    if len(parts) > 1:
                        click_candidates.append(parts[1])  # ex) "독립기념관"
                if bid_no:
                    click_candidates.append(bid_no.split("-")[0])

                clicked = False
                for ct in click_candidates:
                    try:
                        target = page.get_by_text(ct, exact=False).first
                        await target.scroll_into_view_if_needed(timeout=8000)
                        await target.click(timeout=8000)
                        D(f"공고 클릭 OK ({ct!r})")
                        clicked = True
                        break
                    except Exception as e:
                        D(f"클릭 시도 실패 ({ct!r}): {type(e).__name__}")

                if not clicked:
                    # 폴백: 검색 결과 grid 의 한국어 텍스트 들어간 첫 셀
                    fb_id = await page.evaluate(
                        """
                        () => {
                          for (const td of document.querySelectorAll('td')) {
                            const t = (td.innerText||'').trim();
                            if (t.length > 8 && t.length < 200 && /[가-힣]/.test(t)
                                && !/^\\d{4}-\\d{2}/.test(t)) {
                              return td.id || null;
                            }
                          }
                          return null;
                        }
                        """
                    )
                    if fb_id:
                        try:
                            await page.click(f"#{fb_id}", timeout=10000)
                            D(f"폴백 셀 클릭 OK (#{fb_id})")
                            clicked = True
                        except Exception as e:
                            D(f"폴백 클릭 실패: {e}")

                if not clicked:
                    raise RuntimeError("공고 클릭 모든 후보 실패")
                await page.wait_for_timeout(7000)

                # 5) 첨부 파일 셀 enum (.hwp/.hwpx/.pdf/.doc/.docx/.zip/.xlsx)
                file_cells = await page.evaluate(
                    """
                    () => {
                      const out = [];
                      for (const td of document.querySelectorAll('td')) {
                        const t = (td.innerText||'').trim();
                        if (/\\.(hwp|hwpx|pdf|doc|docx|zip|xlsx)$/i.test(t) && t.length < 200) {
                          out.push(t);
                        }
                      }
                      return out;
                    }
                    """
                )
                D(f"첨부 파일 셀 {len(file_cells)}개: {file_cells}")

                # 6) 각 파일 순차 클릭 — 클릭당 4개 fileUpload.do body 캡처됨
                for i, fname in enumerate(file_cells, 1):
                    before = len(bodies)
                    try:
                        el = page.get_by_text(fname, exact=False).first
                        await el.scroll_into_view_if_needed(timeout=5000)
                        await el.click(timeout=8000)
                        await page.wait_for_timeout(8000)
                        D(f"[{i}/{len(file_cells)}] {fname} → +{len(bodies)-before} bodies")
                    except Exception as e:
                        D(f"[{i}/{len(file_cells)}] 클릭 실패: {e}")

                # 쿠키 추출 (httpx에 동일 세션으로 호출)
                ck = await ctx.cookies()
                cookies = {c["name"]: c["value"] for c in ck}
            finally:
                await browser.close()
    except Exception as e:
        D(f"FATAL: {type(e).__name__}: {e}")

    # 7) 캡처한 모든 body httpx로 호출 → binary 응답만 저장
    URL = "https://www.g2b.go.kr/fs/fsc/fsca/fileUpload.do"
    H = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "ko,en-US;q=0.9,en;q=0.8",
        "Cache-Control": "max-age=0",
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": "https://www.g2b.go.kr",
        "Referer": "https://www.g2b.go.kr/",
        "Sec-Fetch-Dest": "iframe",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    }
    results: list[dict] = []
    async with httpx.AsyncClient(cookies=cookies, headers=H, timeout=60, follow_redirects=True) as cli:
        for body in bodies:
            try:
                r = await cli.post(URL, content=body)
            except Exception:
                continue
            cd = r.headers.get("content-disposition", "")
            h = r.content[:8].hex()
            is_bin = "filename" in cd.lower() or h.startswith(
                ("d0cf11e0", "504b0304", "25504446", "ffd8ff", "89504e47")
            )
            if not is_bin:
                continue
            name = ""
            m = re.search(r'filename="([^"]+)"', cd)
            if m:
                from urllib.parse import unquote as _unq
                name = _unq(m.group(1))
            if not name:
                ext = ".bin"
                if h.startswith("d0cf11e0"):
                    ext = ".hwp"
                elif h.startswith("504b0304"):
                    ext = ".hwpx"
                elif h.startswith("25504446"):
                    ext = ".pdf"
                name = f"file_{len(results) + 1}{ext}"
            results.append({"name": name, "bytes": r.content})
    D(f"httpx 다운로드 완료: {len(results)}개 binary 응답")
    return results, log


# ─────────────────────────────────────────────────────────────
# 텍스트 추출 (.pdf / .hwpx / .hwp)
# ─────────────────────────────────────────────────────────────
def _extract_pdf(b: bytes) -> str:
    try:
        from pypdf import PdfReader
        reader = PdfReader(_io.BytesIO(b))
        return "\n".join((p.extract_text() or "") for p in reader.pages)
    except Exception as e:
        return f"[PDF 추출 실패: {e}]"


def _extract_hwpx(b: bytes) -> str:
    try:
        z = zipfile.ZipFile(_io.BytesIO(b))
        parts: list[str] = []
        for name in z.namelist():
            if "section" in name.lower() and name.endswith(".xml"):
                xml = z.read(name).decode("utf-8", errors="ignore")
                text = re.sub(r"<[^>]+>", " ", xml)
                text = re.sub(r"\s+", " ", text).strip()
                if text:
                    parts.append(text)
        return "\n".join(parts)
    except Exception as e:
        return f"[HWPX 추출 실패: {e}]"


def _extract_hwp(b: bytes) -> str:
    """OLE2 기반 .hwp — BodyText 스트림에서 utf-16-le 텍스트 발췌."""
    try:
        import olefile
        ole = olefile.OleFileIO(_io.BytesIO(b))
        parts: list[str] = []
        for stream_path in ole.listdir():
            path_str = "/".join(stream_path)
            if "BodyText" not in path_str:
                continue
            try:
                data = ole.openstream(stream_path).read()
                # 압축 해제 시도 (raw deflate)
                try:
                    data = zlib.decompress(data, -15)
                except Exception:
                    pass
                # utf-16-le 디코딩 + 제어문자 제거
                text = data.decode("utf-16-le", errors="ignore")
                text = "".join(c for c in text if c.isprintable() or c in "\n\r\t ")
                text = re.sub(r"\s+", " ", text).strip()
                if text:
                    parts.append(text)
            except Exception:
                continue
        return "\n".join(parts)
    except Exception as e:
        return f"[HWP 추출 실패: {e}]"


def extract_text(file_bytes: bytes, filename: str) -> str:
    ext = Path(filename).suffix.lower()
    if ext == ".pdf":
        return _extract_pdf(file_bytes)
    if ext == ".hwpx":
        return _extract_hwpx(file_bytes)
    if ext == ".hwp":
        return _extract_hwp(file_bytes)
    return ""


def combine_texts(files: list[dict]) -> str:
    """다운받은 파일들에서 텍스트 추출 — PDF 우선, 없으면 hwp/hwpx."""
    pdf_parts: list[str] = []
    hwp_parts: list[str] = []
    for f in files:
        name = f.get("name", "")
        ext = Path(name).suffix.lower()
        if ext not in (".pdf", ".hwp", ".hwpx"):
            continue
        t = extract_text(f["bytes"], name)
        if not t or t.startswith("["):
            continue
        block = f"\n\n=== {name} ===\n\n{t}"
        if ext == ".pdf":
            pdf_parts.append(block)
        else:
            hwp_parts.append(block)
    # PDF 가 추출됐으면 그것만 사용 (.hwp 와 동일 내용이라 중복 방지)
    return "".join(pdf_parts) if pdf_parts else "".join(hwp_parts)


# ─────────────────────────────────────────────────────────────
# GPT 요약
# ─────────────────────────────────────────────────────────────
SUMMARY_SYSTEM = (
    "당신은 한국 정부·공공기관의 채용대행 용역 입찰공고를 분석해 "
    "핵심 정보를 정확히 추출하는 전문가입니다. "
    "추측 금지 — 본문에 명시되거나 명확히 유도되는 정보만 적습니다."
)


def _build_summary_prompt(text: str, bid_no: str, bid_name: str) -> str:
    bid_main = bid_no.split("-")[0] if bid_no else ""
    bid_ord = bid_no.split("-")[1] if "-" in bid_no else "000"
    truncated = text[:18000]
    return f"""다음은 g2b 나라장터 채용대행 용역 입찰공고 문서에서 추출한 텍스트입니다.
공고번호: {bid_no}
공고명: {bid_name}

여기서 아래 항목을 추출하여 **정확히 아래 마크다운 형식 그대로만** 출력하세요.

[규칙]
1. 본문에 명시되지 않은 항목은 `미상` 으로 표기
2. **간접 참조 처리**: "제안서 제출기간은 입찰서 접수기간과 동일", "위와 같음", "별도 통보" 같은 식으로
   적힌 경우, 본문에서 해당 기간을 찾아 그대로 적용. (예: 입찰서 일정만 명시되어 있고
   제안서가 "입찰서와 동일"이면 두 항목 모두 같은 날짜 시각을 적기.)
3. **금액**: 부가세 포함/미포함 명시. 추정가격·배정예산·사업금액 중 본문 표현 그대로
4. **채용규모**: 기간(예: 착수일로부터 N일) / 인원(직군별 분류 있으면 함께)
5. **담당자**: 부서명(전화번호) 형식. 여러 명이면 첫 1~2명만
6. **평가정보**: 평가일자, 발표시간, 질의응답시간 등 본문에 있는 만큼만
7. 출력에 ```마크다운``` 같은 코드블록 표시 금지 — 텍스트만

[출력 형식]

{bid_main} - {bid_ord}
- 업체명: <발주기관명>
- 공고명: <공고명>
- 채용규모: <기간 / 인원>
- 담당자: <부서명(전화번호)>
- 제출기간
  ㅇ 입찰서 - <날짜시각 (제출방법)>
  ㅇ 제안서 - <날짜시각 (제출방법)>
- 가격: <금액>
- 평가정보: <평가일자, 발표/질의응답 시간>

[입찰공고 본문]
{truncated}
"""


async def summarize_async(text: str, bid_no: str, bid_name: str) -> str:
    """GPT 호출하여 요약 마크다운 반환. 키 없으면 안내, 실패 시 에러 메시지."""
    bid_header = f"{bid_no} ({bid_name})" if bid_name else bid_no
    if not OPENAI_API_KEY:
        return (
            f"# {bid_header}\n\n"
            f"⚠️ OPENAI_API_KEY 미설정 — `server/.env` 에 키를 추가하세요.\n"
            f"`.env.example` 참고."
        )
    if not text.strip():
        return f"# {bid_header}\n\n⚠️ 추출된 본문 텍스트가 없어 요약 불가."

    try:
        from openai import AsyncOpenAI
    except ImportError:
        return f"# {bid_header}\n\n⚠️ openai 라이브러리 미설치"

    client = AsyncOpenAI(api_key=OPENAI_API_KEY)
    prompt = _build_summary_prompt(text, bid_no, bid_name)
    try:
        resp = await client.chat.completions.create(
            model=OPENAI_MODEL,
            temperature=0.1,
            messages=[
                {"role": "system", "content": SUMMARY_SYSTEM},
                {"role": "user", "content": prompt},
            ],
        )
        return resp.choices[0].message.content or ""
    except Exception as e:
        return f"# {bid_header}\n\n⚠️ GPT 호출 실패: {type(e).__name__}: {e}"


@app.post("/api/download-zip")
async def api_download_zip(req: _ZipReq):
    """첨부파일 일괄 다운로드 → 텍스트 추출 → GPT 요약 → ZIP 스트리밍."""
    _log(f"[zip] 시작: {req.bidNo} {req.name}")
    files_out: list[dict] = []
    err: str | None = None
    diag_lines: list[str] = []
    try:
        files_out, diag_lines = await _automate_download(req.bidNo, req.name)
    except Exception as e:
        err = f"{type(e).__name__}: {e}"
        _log(f"[zip] 자동화 실패: {err}")

    # 텍스트 추출 + GPT 요약
    summary_md = ""
    if files_out:
        combined = combine_texts(files_out)
        _log(f"[zip] 추출 텍스트 {len(combined)}자")
        if combined:
            summary_md = await summarize_async(combined, req.bidNo, req.name)
            _log(f"[zip] GPT 요약 {len(summary_md)}자")

    # ZIP 작성 (in-memory)
    buf = _io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in files_out:
            try:
                zf.writestr(f["name"], f["bytes"])
            except Exception as e:
                diag_lines.append(f"zip write 실패 {f.get('name')}: {e}")
        if summary_md:
            zf.writestr("_summary.md", summary_md.encode("utf-8"))
        if not files_out:
            zf.writestr(
                "_FAILED.txt",
                (
                    f"[자동 다운로드 실패]\n\n"
                    f"공고번호: {req.bidNo}\n"
                    f"공고명: {req.name}\n"
                    f"에러: {err or '(파일 0개)'}\n\n"
                    f"--- diag ---\n" + "\n".join(diag_lines)
                ).encode("utf-8"),
            )
    buf.seek(0)

    ascii_name = re.sub(r"[^\x20-\x7e]+", "_", req.name or req.bidNo or "files")[:60]
    utf8_name = quote(f"{req.bidNo or 'g2b'}_{req.name or 'files'}.zip", safe="")
    # 요약 일부를 응답 헤더에 base64로 (프론트 inline 표시용, 4KB 제한)
    summary_b64 = ""
    if summary_md:
        truncated = summary_md[:3000]
        summary_b64 = base64.b64encode(truncated.encode("utf-8")).decode("ascii")
    _log(f"[zip] 종료: {len(files_out)}개 파일, 요약 {len(summary_md)}자")
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{req.bidNo or "g2b"}_{ascii_name}.zip"; '
                f"filename*=UTF-8''{utf8_name}"
            ),
            "X-File-Count": str(len(files_out)),
            "X-Summary-B64": summary_b64,
            "Access-Control-Expose-Headers": "X-File-Count, X-Summary-B64",
        },
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=3001)
