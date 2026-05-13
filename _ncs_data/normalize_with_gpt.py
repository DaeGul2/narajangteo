"""GPT 로 기관명 정규화 → _ncs_data/inst_map.json 캐시 생성."""
from __future__ import annotations
import json
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

ROOT = Path(__file__).parent
load_dotenv(ROOT.parent / 'server' / '.env')

CACHE = ROOT / 'inst_map.json'
BATCH_SIZE = 50
MODEL = os.getenv('OPENAI_MODEL', 'gpt-4.1-mini')

SYSTEM = "당신은 한국 공공기관·공기업·재단·공공단체의 정식 명칭을 정확히 식별하는 전문가입니다."

EXAMPLES = """
[예시]
- 한국전자통신연구원 2021년 → 한국전자통신연구원
- 한국농어촌공사 5 → 한국농어촌공사
- 한국농어촌공사 제주지역 → 한국농어촌공사
- 한국농어촌공사 7급사원 무기계약직 → 한국농어촌공사
- 광주도시관리공사 제1차 → 광주도시관리공사
- 한국중부발전 보훈대상자 5, 6직급 → 한국중부발전
- 한국중부발전 5·6직급 → 한국중부발전
- 서울교통공사 9호선 운영부문 → 서울교통공사
- 서울교통공사 9호선 → 서울교통공사
- 경기도 공공기관 통합채용 → 경기도
- 경상북도 공공기관 통합채용 → 경상북도
- 광주광역시 공공기관 통합채용 → 광주광역시
- 광주광역시 서구시설관리공단 → 광주광역시 서구시설관리공단
- 광주광역시 광산구시설관리공단 → 광주광역시 광산구시설관리공단
- 인천광역시 중구시설관리공단 제2회 → 인천광역시 중구시설관리공단
- 한국지역난방공사 전문직 → 한국지역난방공사
- 한국지역난방공사 전문 → 한국지역난방공사
- 인천국제공항공사 방재직 → 인천국제공항공사
- 충주의료원 → 충주의료원
- 정선군상권활성화재단 → 정선군상권활성화재단
- 정성군상권활성화재단 → 정선군상권활성화재단
- 방송통신심의의원회 → 방송통신심의위원회
- 코레일네트웍스 → 코레일네트웍스
- 코레일네트웍스 1분기 공개 → 코레일네트웍스
- 코레일테크 → 코레일테크
- 코레일유통 → 코레일유통
- 한국철도공사 → 한국철도공사
- 코레일 → 한국철도공사
- 과학기술분야 정부출연연구기관 → 과학기술분야 정부출연연구기관
- 과학기술분야 정부출연연구기관 제1차 공동채용 → 과학기술분야 정부출연연구기관
- 서울시여성가족재단 → 서울특별시여성가족재단
- 서울특별시 여성가족재단 → 서울특별시여성가족재단
- 충청남도일자리경제진흥원 → 충청남도일자리진흥원
- 강원개발공사 → 강원도개발공사
- 강원관광재단 → 강원도관광재단
- 여주세종문화관광재단 → 여주세종문화재단
- 대구경북첨단의료산업진흥원 → 대구경북첨단의료산업진흥재단
- 한국보훈복지의료공단 사무직 → 한국보훈복지의료공단
- 국립생태원 멸종위기종복원센터 → 국립생태원
- 안양시청소년재단 3회 → 안양시청소년재단
- 새만금개발공사 수시채용 → 새만금개발공사
- 새만금개발공사 수시 → 새만금개발공사
- 한국어촌어항공단 공채 6기 → 한국어촌어항공단
- 한국석유관리원 사회형평적인재 → 한국석유관리원
- 과천도시공사 행정7급 → 과천도시공사
- 과천도시공사 행정 → 과천도시공사
- 국가과학기술연구회 과학기술정책분야 → 국가과학기술연구회
- 한국산업은행 전문직 B → 한국산업은행
- 한국산업은행 전문직B → 한국산업은행
- 서울특별시미디어재단티비에스 → 서울특별시미디어재단티비에스
- 인천광역시서구시설관리공단 → 인천광역시 서구시설관리공단
"""

USER_TEMPLATE = """다음 한국 공공기관 표기 리스트의 각 항목에서 '순수 기관명'만 추출해주세요.

[규칙]
1. 사업명/회차/직군/연도/숫자/지역한정/모집유형(보훈/경력/신입/체험형/사회형평적 등)/직급(N급, N직급, N급사원 등) 같은 부가 정보는 모두 제거
2. 법인격을 가진 최소 단위까지 유지 (공단/공사/진흥원/연구원/재단/병원/대학교/대학병원/센터/협회/위원회/공기업/관리원 등 접미사로 끝나는 곳까지)
3. 자치구별 시설관리공단은 자치구명까지 보존 (광주광역시 서구시설관리공단)
4. 도/시 prefix 정식 명칭으로 통일 (서울시→서울특별시, 대전시→대전광역시 등)
5. '~ 공공기관 통합채용' 같은 통합채용 사업은 발주 광역지자체만 (경기도, 경상북도 등)
6. 명백한 오타·표기 누락 정정 (강원→강원도, 정성군→정선군, 의원회→위원회, 시→특별시)
7. 코레일 단독 → 한국철도공사 (정식 본사명). 자회사(코레일네트웍스/테크/유통/로지스)는 그대로
8. 더 줄일 수 없거나 모호하면 원본 그대로

{examples}

[입력 — 정제할 표기들]
{names}

[출력 형식]
JSON object. 각 입력 표기를 키로, 정제된 기관명을 값으로. 모든 입력 항목 빠짐없이 응답.
"""


def call_gpt(client: OpenAI, names_batch: list[str]) -> dict[str, str]:
    user = USER_TEMPLATE.format(
        examples=EXAMPLES,
        names=json.dumps(names_batch, ensure_ascii=False, indent=2),
    )
    resp = client.chat.completions.create(
        model=MODEL,
        temperature=0,
        messages=[
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": user},
        ],
        response_format={"type": "json_object"},
    )
    return json.loads(resp.choices[0].message.content or '{}')


def main():
    # 캐시
    cache: dict[str, str] = {}
    if CACHE.exists():
        cache = json.loads(CACHE.read_text(encoding='utf-8'))
        print(f'캐시 로드: {len(cache)}개')

    # raw unique 기관 표기 모음
    sys.path.insert(0, str(ROOT))
    from parse_and_export import parse_year, is_noise
    raw_set: set[str] = set()
    for year in ('2020', '2021', '2022', '2023', '2024', '2025'):
        for r in parse_year(year, ROOT / f'{year}.txt'):
            if not is_noise(r[3]):
                raw_set.add(r[3])
    raw_names = sorted(raw_set)
    print(f'unique raw 표기: {len(raw_names)}')

    missing = [n for n in raw_names if n not in cache]
    print(f'GPT 호출 필요: {len(missing)}개 (배치 {BATCH_SIZE})')
    if not missing:
        print('업데이트 없음.')
        return

    api_key = os.getenv('OPENAI_API_KEY')
    if not api_key:
        print('❌ OPENAI_API_KEY 미설정 — server/.env 확인')
        return
    client = OpenAI(api_key=api_key)

    total_batches = (len(missing) + BATCH_SIZE - 1) // BATCH_SIZE
    for i in range(0, len(missing), BATCH_SIZE):
        bn = i // BATCH_SIZE + 1
        batch = missing[i:i + BATCH_SIZE]
        print(f'  batch {bn}/{total_batches} ({len(batch)}개)...', end=' ', flush=True)
        try:
            result = call_gpt(client, batch)
            # 누락된 키 확인
            missed = [n for n in batch if n not in result]
            for n in missed:
                result[n] = n  # 그대로 사용
            cache.update(result)
            CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding='utf-8')
            print(f'OK (missed={len(missed)})')
        except Exception as e:
            print(f'ERR: {e}')
            continue
        time.sleep(0.3)

    print(f'\n✅ 완료. 캐시 크기: {len(cache)}')
    print(f'캐시 파일: {CACHE}')


if __name__ == '__main__':
    main()
