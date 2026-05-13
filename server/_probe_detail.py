"""디테일 페이지의 어떤 API가 '입찰진행정보' grid를 채우는지 식별하는 일회성 프로브."""
from __future__ import annotations
import io, json, re, sys
import httpx

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

# 사용자가 제공한 cURL의 쿠키 (디테일 페이지 진입 시점)
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

# 후보 API들과 그 페이로드 (실제 cURL에서 가져옴, R26BK01480852-000 공고)
CANDIDATES: list[tuple[str, str, dict]] = [
    (
        "selectCmmStepBarPrss",
        "https://www.g2b.go.kr/fa/fas/fasa/BsnePrssPrgrs/selectCmmStepBarPrss.do",
        {
            "dlBsnePrssPrgrsM": {
                "prgrsUntyPrcmBsneNo": "R26BK01480852000",
                "entryCndtn": {"usrTyCd": "이030003", "prcmBsneSeCd": "03"},
                "afrStepViewYn": "",
                "stepBsneUntNo": "00900",
                "bsneFlowNo": "",
                "gupBsneUntNo": "00892",
                "prssViewYn": "N",
                "prssBsneUntNo": "00903",
                "orgPrgrsUntyPrcmBsneNo": "",
                "nprsLnkYn": "Y",
                "prgrsViewYn": "Y",
                "afrPrcdrViewYn": "Y",
                "bsneFlowCangVal": "",
                "inQryDiv": "",
            }
        },
    ),
    (
        "selectCmmStepBar",
        "https://www.g2b.go.kr/fa/fas/fasa/BsnePrssPrgrs/selectCmmStepBar.do",
        {
            "dlBsnePrssPrgrsM": {
                "precUntyPrcmBsneNo": "",
                "prgrsUntyPrcmBsneNo": "R26BK01480852000",
                "entryCndtn": {
                    "usrTyCd": "이030003",
                    "prcmBsneSeCd": "03",
                    "infoSysCd": "정010029",
                },
                "afrStepViewYn": "",
                "bsneFlowCangVal": "",
                "bsneFlowNo": "",
                "prssViewYn": "",
                "gupBsneUntNo": "01550",
                "stepBsneUntNo": "01558",
                "prssBsneUntNo": "",
                "nprsLnkYn": "",
                "prgrsViewYn": "",
                "prcmBsneSeCd": "03",
                "bidPbancNo": "R26BK01480852",
                "bidPbancOrd": "000",
                "gupClickYn": "Y",
                "stepClickYn": "Y",
                "nprsStepClickYn": "",
                "prcmBsneUntyNo": "",
                "prcmBsneUntyOrd": "",
                "prcmBsneUntyOdn3Val": "",
                "prcmBsneUntyOdn4Val": "",
                "prcmBsneUntyOdn5Val": "",
                "prcmBsneUntyOdn6Val": "",
                "prcmBsneUntyOdn7Val": "",
            }
        },
    ),
    (
        "selectItemAnncMngV",
        "https://www.g2b.go.kr/pn/pnp/pnpe/ItemBidPbac/selectItemAnncMngV.do",
        {"dmItemMap": {"bidPbancNo": "R26BK01480852", "bidPbancOrd": "000", "scsbdMthdCd": "낙030005", "currentPage": 1, "recordCountPerPage": ""}},
    ),
]


def main() -> None:
    target_keys = {"subject", "startDt", "endDt", "placNm", "prgNm"}
    with httpx.Client(cookies=COOKIES, headers=HEADERS, timeout=30) as client:
        for name, url, body in CANDIDATES:
            print(f"\n========== {name} ==========")
            try:
                r = client.post(url, json=body)
                print(f"HTTP {r.status_code}, {len(r.content)} bytes")
                try:
                    data = r.json()
                except Exception:
                    print(f"non-JSON body: {r.text[:300]}")
                    continue

                # 본문에 나타난 키 전부 수집
                seen_keys: set[str] = set()
                lists_with_target: list[tuple[str, int]] = []

                def walk(obj, path=""):
                    if isinstance(obj, dict):
                        for k, v in obj.items():
                            seen_keys.add(k)
                            walk(v, f"{path}.{k}" if path else k)
                    elif isinstance(obj, list):
                        if obj and isinstance(obj[0], dict):
                            keys_first = set(obj[0].keys())
                            if target_keys & keys_first:
                                lists_with_target.append((path, len(obj)))
                            walk(obj[0], f"{path}[0]")
                        for i, item in enumerate(obj[:1]):
                            walk(item, f"{path}[{i}]")

                walk(data)
                hits = target_keys & seen_keys
                print(f"target-key 매칭: {sorted(hits)}")
                if lists_with_target:
                    print(f"⭐ 입찰진행정보 grid 후보 리스트:")
                    for p, n in lists_with_target:
                        print(f"   - 경로: {p}, 행수: {n}")
                # 응답 전체를 디버그 파일로 저장
                from pathlib import Path
                Path("_debug").mkdir(exist_ok=True)
                Path(f"_debug/probe_{name}.json").write_text(
                    json.dumps(data, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
                print(f"   응답 저장: _debug/probe_{name}.json")
            except Exception as e:
                print(f"ERR: {e}")


if __name__ == "__main__":
    main()
