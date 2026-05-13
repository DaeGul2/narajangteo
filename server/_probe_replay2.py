"""4번째 iframe-navigation 요청 replay → 실제 파일 binary 받기 시도."""
from __future__ import annotations
import io, sys
from pathlib import Path
import httpx

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

DEBUG = Path(__file__).parent / "_debug" / "replay2"
DEBUG.mkdir(parents=True, exist_ok=True)

COOKIES = {
    "JSESSIONID": "NmJkOGYyNTktM2Q1ZS00YTJlLWFjYjktZGI5NzU1MzkzMTQ3",
    "WHATAP": "z3u6nutq3g2a4",
    "XTVID": "A2605121516006338",
    "infoSysCd": "%EC%A0%95010029",
    "_harry_fid": "hh-305927250",
    "xloc": "2560X1441",
    "_harry_lang": "ko",
    "system_language": "ko",
    "poupR23AB00000134631": "done",
    "lastAccess": "1778570848648",
    "_harry_url": "https%3A//www.g2b.go.kr/",
    "_harry_hsid": "A260512171954869360",
    "_harry_dsid": "A260512171954870154",
    "XTSID": "A260512171954870705",
    "globalDebug": "false",
}

URL = "https://www.g2b.go.kr/fs/fsc/fsca/fileUpload.do"
# 사용자 cURL의 헤더 그대로 (iframe navigation)
H = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "ko,en-US;q=0.9,en;q=0.8,th;q=0.7",
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
    "sec-ch-ua": '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
}

# cURL의 --data-raw 그대로 (double-URL-encoded 상태 유지)
BODY = (
    "k01=2kO1TCmzXLECES4BJAJsm0Eza%252BNZ4EvSlzTaUYCsmTIgCFm6gE1M7wSsfMW%2FWrFxRsXsJOyeI1T%252BgBAPZuxWN4bytotw8cUC4sl2TX"
    "%252Bb3HwmEIxGSKCY1rhZlaxYXSjGcjmUO%2FZEDDOVM12P4YG%252BRZkeuxFrHwDA3gpTTJaaGCkS0NS%2FBLJbEH81Jtuv31B20OVZDJxzGOTG9R"
    "pQtVf4XNyVCpUXSROP2lZSmp8aCWWRiffiQ3hdnOG3tQLtWEfaNJ1LtmYTCQH2S2z9HTFCZSmnuJxI3yrBwA0wQA5GaysZMZT88RPTD8delo%252BYZnj5"
    "&X-CSRF-Token="
)


def main():
    print("== iframe-navigation replay ==")
    with httpx.Client(cookies=COOKIES, headers=H, timeout=60, follow_redirects=True) as c:
        r = c.post(URL, content=BODY)
    print(f"status={r.status_code}, size={len(r.content)}B")
    print("response headers:")
    for k, v in r.headers.items():
        print(f"  {k}: {v}")
    print(f"\n첫 32B (hex): {r.content[:32].hex()}")
    print(f"첫 200B (text): {r.content[:200].decode('utf-8', errors='replace')!r}")

    # 확장자 판별
    h = r.content[:8].hex()
    cd = r.headers.get("content-disposition", "").lower()
    ct = r.headers.get("content-type", "").lower()
    ext = "bin"
    if h.startswith("25504446") or "pdf" in cd:
        ext = "pdf"
    elif h.startswith("504b0304") or "hwpx" in cd or "xlsx" in cd or "docx" in cd or "zip" in cd:
        ext = "hwpx"  # zip 시그니처: hwpx/docx/xlsx/zip 모두
    elif h.startswith("d0cf11e0") or "hwp" in cd or "doc" in cd:
        ext = "hwp"  # OLE: hwp/doc/xls
    elif "html" in ct or h.startswith("3c"):
        ext = "html"
    p = DEBUG / f"resp_{len(r.content)}B.{ext}"
    p.write_bytes(r.content)
    print(f"\n💾 saved: {p}")
    print(f"⏬ Content-Disposition: {r.headers.get('content-disposition')!r}")


if __name__ == "__main__":
    main()
