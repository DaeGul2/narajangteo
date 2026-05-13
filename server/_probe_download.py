"""파일 다운로드 URL 패턴 탐색."""
from __future__ import annotations
import io, sys
import httpx

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

COOKIES = {
    "JSESSIONID": "NmJkOGYyNTktM2Q1ZS00YTJlLWFjYjktZGI5NzU1MzkzMTQ3",
    "WHATAP": "z3u6nutq3g2a4",
    "XTVID": "A2605121516006338",
    "infoSysCd": "%EC%A0%95010029",
    "_harry_url": "https%3A//www.g2b.go.kr/",
    "_harry_fid": "hh-305927250",
    "xloc": "2560X1441",
    "_harry_lang": "ko",
    "system_language": "ko",
    "poupR23AB00000134631": "done",
    "lastAccess": "1778570300629",
}
H = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    "Referer": "https://www.g2b.go.kr/",
}

uno = "f43e74b9-52cb-4003-9699-053f8f5602cb"
seq = "1"

candidates = [
    # 가장 흔한 패턴들
    ("GET", f"https://www.g2b.go.kr/fs/fsc/fscb/UntyAtchFile/downloadFile.do?untyAtchFileNo={uno}&atchFileSqno={seq}", None),
    ("GET", f"https://www.g2b.go.kr/fs/fsc/fsca/fileDownload.do?untyAtchFileNo={uno}&atchFileSqno={seq}", None),
    ("GET", f"https://www.g2b.go.kr/fs/fsc/fscb/UntyAtchFile/downloadUntyAtchFile.do?untyAtchFileNo={uno}&atchFileSqno={seq}", None),
    ("POST", "https://www.g2b.go.kr/fs/fsc/fscb/UntyAtchFile/downloadUntyAtchFile.do",
        {"dlUntyAtchFileM": {"untyAtchFileNo": uno, "atchFileSqno": seq}}),
    ("POST", "https://www.g2b.go.kr/fs/fsc/fscb/UntyAtchFile/downloadFile.do",
        {"dlUntyAtchFileM": {"untyAtchFileNo": uno, "atchFileSqno": seq}}),
    ("GET", f"https://www.g2b.go.kr/fs/fsc/fscb/UntyAtchFile/selectUntyAtchFileDownload.do?untyAtchFileNo={uno}&atchFileSqno={seq}", None),
    ("GET", f"https://www.g2b.go.kr/cm/cmm/cmma/UntyAtchFile/downloadUntyAtchFile.do?untyAtchFileNo={uno}&atchFileSqno={seq}", None),
    ("GET", f"https://www.g2b.go.kr/kupload/fileDownload.do?untyAtchFileNo={uno}&atchFileSqno={seq}", None),
]

with httpx.Client(cookies=COOKIES, headers=H, timeout=15, follow_redirects=False) as cli:
    for method, url, body in candidates:
        try:
            if method == "GET":
                r = cli.get(url)
            else:
                r = cli.post(url, json=body)
            ct = r.headers.get("content-type", "")
            cd = r.headers.get("content-disposition", "")
            size = len(r.content)
            print(f"[{method}] {url[-80:]:80s} → {r.status_code}, {size:>9}B, ct={ct[:30]:30s}, cd={cd[:50]}")
        except Exception as e:
            print(f"[{method}] {url[-80:]:80s} → ERR {e}")
