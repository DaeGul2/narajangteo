"""첨부파일 리스트 API + 다운로드 URL 패턴 확인."""
from __future__ import annotations
import io, json, sys
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

HEADERS = {
    "Accept": "application/json",
    "Content-Type": "application/json;charset=UTF-8",
    "Origin": "https://www.g2b.go.kr",
    "Referer": "https://www.g2b.go.kr/",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
    ),
    "Menu-Info": (
        '{"menuNo":"01196","menuCangVal":"PNPE027_01",'
        '"bsneClsfCd":"%EC%97%85130026","scrnNo":"06085"}'
    ),
    "Usr-Id": "UN00000120665",
}


def main() -> None:
    with httpx.Client(cookies=COOKIES, headers=HEADERS, timeout=30) as client:
        # 1) detail 응답에서 첨부파일 관련 필드 찾기
        print("\n=== detail (selectItemAnncMngV) 응답의 첨부 관련 필드 ===")
        d = json.load(
            open(
                r"C:\Users\alsxo\Desktop\공용\1_인사바른\나라장터크롤링\server\_debug\probe_selectItemAnncMngV.json",
                encoding="utf-8",
            )
        )
        m = d.get("dmItemMap") or {}
        for k in sorted(m.keys()):
            v = m[k]
            if "atchFile" in k.lower() or "atch_file" in k.lower() or "atchfile" in k.lower():
                print(f"  {k}: {v!r}")

        # 2) selectUntyAtchFileList.do 호출
        print("\n=== selectUntyAtchFileList.do ===")
        # 사용자 cURL에서 본 그 공고(R26BK01480852)에 매칭되는 untyAtchFileNo
        # 일단 cURL에서 본 그 ID를 그대로 시도
        atch_file_no = "f43e74b9-52cb-4003-9699-053f8f5602cb"
        r = client.post(
            "https://www.g2b.go.kr/fs/fsc/fscb/UntyAtchFile/selectUntyAtchFileList.do",
            json={
                "dlUntyAtchFileM": {
                    "untyAtchFileNo": atch_file_no,
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
                    "kuploadId": "test",
                    "viewMode": "view",
                }
            },
        )
        print(f"HTTP {r.status_code}, {len(r.content)} bytes")
        data = r.json()
        print(f"top-level keys: {list(data.keys())}")
        for k, v in data.items():
            if isinstance(v, list) and v and isinstance(v[0], dict):
                print(f"\n>>> '{k}' list (len={len(v)}), first row keys: {list(v[0].keys())}")
                print(f"    sample row: {json.dumps(v[0], ensure_ascii=False, indent=2)[:1500]}")

        # 응답 저장
        from pathlib import Path
        Path("_debug").mkdir(exist_ok=True)
        Path("_debug/probe_atchFileList.json").write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print("\n_debug/probe_atchFileList.json 저장")


if __name__ == "__main__":
    main()
