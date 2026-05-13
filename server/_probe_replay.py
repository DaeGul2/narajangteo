"""
사용자가 직접 클릭한 다운로드의 3개 cURL(=fetch)을 순서대로 그대로 replay.
각 응답의 status/headers/size/첫 바이트들을 저장해서 어떤 게 실제 파일인지 확인.
"""
from __future__ import annotations
import io, sys, time
from pathlib import Path
import httpx

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

DEBUG = Path(__file__).parent / "_debug" / "replay"
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
H = {
    "Accept": "*/*",
    "Accept-Language": "ko,en-US;q=0.9,en;q=0.8,th;q=0.7",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "Origin": "https://www.g2b.go.kr",
    "Referer": "https://www.g2b.go.kr/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    "X-CSRF-Token": "",
    "sec-ch-ua": '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
}

URL = "https://www.g2b.go.kr/fs/fsc/fsca/fileUpload.do"

# 사용자가 준 3개의 body를 그대로 (URL-encoded 상태)
BODIES = [
    "k01=lgjA/5jsAwdJByE8nlxOaBOgT41pZgrDIGNM4Gh7lSUpRY6f9EDebIYDAx/2b/s03bGvLOkTAZXHjd35oH0ggxtpcHXEFmYtx3m3ezNIkgEmJtpbj4kQJxqBJqjfR45y1Ee8bmu%2BuOj2zFkBhfRU4YUPBpIHLN3mMcETEItkFwnmVCCywN0zWRCoq9/Rtf89",
    "k01=CSF6sMksr/iQg3JbR3sTbHzXDJflIYyxFsnUmvw9jDASKS9m6AonaBCtlIOBcfwMvDrFVIaj2TPNs0HjFhj77U==",
    "k01=RUB1zrqZhTjpylUdJJVS5ItttFsvj84hlsbthe701L3JGKJt3tScs%2Bz986oa7b6Uk7iISe2alrVFJ%2B4M6%2B7Z%2B1OZKk4IcFWMk2RGS8d495Xhpq%2Bm27hxH2c12MmJqIrejvBWyYDeqqsLmmVCx%2BP8XWKjClPSlNIkSDEL%2Bi6JxvNwj55vGzzD%2BT9gbvyA3wWa7haGL2RyfqnNjenE0voUhtOaQe%2B2lHJoip0Sjn0NkcgehCcC2tpeI833nkWn6fT5EbHy9sFURSF4c8ScqYUwSp==",
]


def main():
    print(f"== replay 시작 ({len(BODIES)}회) ==\n")
    with httpx.Client(cookies=COOKIES, headers=H, timeout=30, follow_redirects=False) as c:
        for i, body in enumerate(BODIES, 1):
            print(f"--- 요청 #{i} (body {len(body)}B) ---")
            t0 = time.time()
            try:
                r = c.post(URL, content=body)
            except Exception as e:
                print(f"  ❌ {e}")
                continue
            dt = (time.time() - t0) * 1000
            ct = r.headers.get("content-type", "")
            cd = r.headers.get("content-disposition", "")
            size = len(r.content)
            head_hex = r.content[:16].hex()
            head_txt = r.content[:200]
            try:
                head_txt_str = head_txt.decode("utf-8", errors="replace")
            except Exception:
                head_txt_str = repr(head_txt)
            print(f"  status={r.status_code} | {dt:.0f}ms | size={size}B")
            print(f"  Content-Type: {ct}")
            print(f"  Content-Disposition: {cd}")
            print(f"  첫 16B (hex): {head_hex}")
            print(f"  첫 200B (text): {head_txt_str[:200]!r}")

            # 추정 확장자
            ext = "bin"
            low = (cd + ct).lower()
            if "pdf" in low or head_hex.startswith("25504446"):
                ext = "pdf"
            elif "hwpx" in low or head_hex.startswith("504b0304"):  # zip 시그니처 = hwpx
                ext = "hwpx"
            elif "hwp" in low or head_hex.startswith("d0cf11e0"):  # OLE 시그니처 = hwp
                ext = "hwp"
            elif "html" in ct.lower() or head_hex.startswith("3c"):
                ext = "html"
            elif "json" in ct.lower() or head_hex.startswith("7b"):
                ext = "json"
            p = DEBUG / f"resp_{i}_{size}B.{ext}"
            p.write_bytes(r.content)
            print(f"  💾 saved: {p.name}\n")


if __name__ == "__main__":
    main()
