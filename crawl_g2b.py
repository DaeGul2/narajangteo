"""
나라장터(g2b.go.kr) 입찰공고 '채용' 키워드 크롤러.

순서:
1) https://www.g2b.go.kr/ 접속
2) 입찰 > 입찰공고 > 입찰공고목록 진입
3) 공고명에 '채용' 입력 후 검색
4) 페이지당 100건 선택
5) 공고명 전부 추출

결과: out/notices.json, out/notices.txt, 단계별 스크린샷 out/step_*.png
"""

from __future__ import annotations

import io
import json
import re
import sys
import time
from pathlib import Path

# 윈도우 콘솔 UTF-8 강제
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

from playwright.sync_api import (
    Page,
    TimeoutError as PWTimeout,
    sync_playwright,
)

ROOT = Path(__file__).parent
OUT = ROOT / "out"
OUT.mkdir(exist_ok=True)


def shot(page: Page, name: str) -> None:
    """디버그용 스크린샷."""
    p = OUT / f"step_{name}.png"
    try:
        page.screenshot(path=str(p), full_page=False)
        print(f"  [shot] {p.name}")
    except Exception as e:
        print(f"  [!] screenshot failed: {e}")


def safe_click(page: Page, selector: str, *, timeout: int = 15000) -> bool:
    try:
        page.locator(selector).first.click(timeout=timeout)
        return True
    except Exception as e:
        print(f"  [!] click 실패 [{selector}]: {e}")
        return False


def wait_for_grid_loaded(page: Page, timeout: int = 30000) -> None:
    """그리드(공고 목록) 행이 로드될 때까지 대기."""
    page.wait_for_function(
        """() => {
            const rows = document.querySelectorAll('[id*="grdBidPbanc"] [id*="_row_"]');
            return rows && rows.length > 0;
        }""",
        timeout=timeout,
    )


def main() -> int:
    keyword = "채용"
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=False, args=["--start-maximized"])
        context = browser.new_context(
            viewport={"width": 1600, "height": 1000},
            locale="ko-KR",
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
        )
        page = context.new_page()

        print("[1] 나라장터 접속")
        page.goto("https://www.g2b.go.kr/", wait_until="domcontentloaded", timeout=90000)
        try:
            page.wait_for_load_state("networkidle", timeout=60000)
        except PWTimeout:
            pass
        time.sleep(2)
        shot(page, "01_home")

        print("[2] 입찰 > 입찰공고 > 입찰공고목록")
        # 1차: 상단 메뉴 '입찰' 호버 → '입찰공고' → '입찰공고목록'
        # Nexacro 구조라 텍스트 기반으로 시도
        clicked = False
        try:
            # 상단 메뉴 '입찰'
            page.get_by_text("입찰", exact=True).first.hover(timeout=10000)
            time.sleep(0.5)
            # 서브메뉴 '입찰공고'
            page.get_by_text("입찰공고", exact=True).first.hover(timeout=5000)
            time.sleep(0.5)
            page.get_by_text("입찰공고목록", exact=True).first.click(timeout=5000)
            clicked = True
        except Exception as e:
            print(f"  [!] 메뉴 클릭 1차 실패: {e}")

        if not clicked:
            # 폴백: 그냥 '입찰공고목록' 텍스트 직접 클릭 시도
            try:
                page.get_by_text("입찰공고목록", exact=True).first.click(timeout=10000)
                clicked = True
            except Exception as e:
                print(f"  [!] 메뉴 클릭 2차 실패: {e}")

        try:
            page.wait_for_load_state("networkidle", timeout=30000)
        except PWTimeout:
            pass
        time.sleep(2)
        shot(page, "02_bid_list")

        print("[3] 공고명에 '채용' 입력 후 검색")
        # 공고명 입력 필드 - id가 'bidPbancNm' 또는 비슷한 패턴
        filled = False
        for sel in [
            'input[id*="bidPbancNm"]:visible',
            'input[id*="BidPbancNm"]:visible',
            'input[id*="bidNm"]:visible',
            'input[title*="공고명"]:visible',
        ]:
            try:
                loc = page.locator(sel).first
                loc.wait_for(state="visible", timeout=5000)
                loc.fill(keyword)
                filled = True
                print(f"  [OK] 공고명 입력: {sel}")
                break
            except Exception:
                continue

        if not filled:
            print("  [!] 공고명 필드 자동 탐색 실패. 라벨로 시도.")
            try:
                # 라벨 옆 input 찾기
                page.get_by_label("공고명").first.fill(keyword, timeout=5000)
                filled = True
            except Exception as e:
                print(f"  [!] 라벨 기반 입력 실패: {e}")

        shot(page, "03_keyword_filled")

        # 검색 버튼
        clicked_search = False
        for sel in [
            'button:has-text("검색"):visible',
            '[id*="btnS0004"]:visible',
            '[id*="btnSearch"]:visible',
            'input[type="button"][value="검색"]:visible',
        ]:
            try:
                page.locator(sel).first.click(timeout=3000)
                clicked_search = True
                print(f"  [OK] 검색 클릭: {sel}")
                break
            except Exception:
                continue

        if not clicked_search:
            print("  [!] 검색 버튼 클릭 실패. Enter 키로 시도.")
            page.keyboard.press("Enter")

        time.sleep(3)
        try:
            page.wait_for_load_state("networkidle", timeout=30000)
        except PWTimeout:
            pass
        shot(page, "04_searched")

        print("[4] 페이지당 100건 선택")
        # 사용자가 알려준 정확한 ID
        select_ids = [
            "mf_wfm_container_tacBidPbancLst_contents_tab2_body_sbxRecordCountPerPage1",
            "mf_wfm_container_tacBidPbancLst_contents_tab1_body_sbxRecordCountPerPage1",
            "mf_wfm_container_tacBidPbancLst_contents_tab3_body_sbxRecordCountPerPage1",
        ]
        for sid in select_ids:
            try:
                el = page.locator(f"#{sid}")
                if el.count() == 0:
                    continue
                if not el.first.is_visible():
                    continue
                el.first.select_option("100")
                print(f"  [OK] 100건 선택: {sid}")
                break
            except Exception as e:
                print(f"  [!] select 실패 {sid}: {e}")

        time.sleep(3)
        try:
            page.wait_for_load_state("networkidle", timeout=30000)
        except PWTimeout:
            pass
        shot(page, "05_100_per_page")

        print("[5] 공고명 추출")
        # 현재 보이는 탭의 그리드에서 공고명 셀 추출
        # Nexacro 그리드는 각 셀이 id에 '_cell_' 포함, 컬럼명에 'PbancNm' 또는 '공고명'
        # 단순화: 그리드의 모든 행을 텍스트로 dump
        notices: list[dict] = []

        # 모든 보이는 그리드 행에서 공고명 열 추출
        # Nexacro 그리드 셀 구조는 div[id*="_cell_{row}_{col}"] 형태
        # 공고명 컬럼 인덱스를 헤더로부터 찾는다
        result = page.evaluate(
            """() => {
                // 보이는 그리드 컨테이너 찾기
                const grids = Array.from(document.querySelectorAll('[id*="grdBidPbanc"]'))
                    .filter(el => el.offsetParent !== null);
                if (grids.length === 0) return {error: "그리드를 찾을 수 없음", grids: 0};
                const grid = grids[0];

                // 헤더 셀 텍스트 수집
                const headers = Array.from(grid.querySelectorAll('[id*="_cell_-1_"]'))
                    .map(el => el.innerText.trim());

                // 공고명 컬럼 인덱스
                let nameColIdx = headers.findIndex(h => h === "공고명" || h.includes("공고명"));

                // 본문 행 셀들
                const cellMap = {};
                grid.querySelectorAll('[id*="_cell_"]').forEach(el => {
                    const m = el.id.match(/_cell_(-?\\d+)_(-?\\d+)/);
                    if (!m) return;
                    const row = parseInt(m[1], 10);
                    const col = parseInt(m[2], 10);
                    if (row < 0) return;
                    if (!cellMap[row]) cellMap[row] = {};
                    cellMap[row][col] = el.innerText.trim();
                });

                const rows = Object.keys(cellMap).map(r => parseInt(r,10)).sort((a,b)=>a-b);
                const data = rows.map(r => {
                    const row = cellMap[r];
                    const obj = {};
                    Object.keys(row).forEach(c => {
                        const colIdx = parseInt(c, 10);
                        const header = headers[colIdx] || `col${colIdx}`;
                        obj[header] = row[c];
                    });
                    return obj;
                });

                return {
                    gridId: grid.id,
                    headers,
                    nameColIdx,
                    rowCount: data.length,
                    data,
                };
            }"""
        )

        print(f"  결과: gridId={result.get('gridId')}, headers={result.get('headers')}")
        print(f"  rows={result.get('rowCount')}, nameColIdx={result.get('nameColIdx')}")

        # 저장
        (OUT / "raw_grid.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        # 공고명 리스트
        names: list[str] = []
        for r in result.get("data", []):
            nm = r.get("공고명") or r.get("col4") or r.get("col5") or ""
            nm = nm.strip()
            if nm and nm != "공고명":
                names.append(nm)

        (OUT / "notices.txt").write_text("\n".join(names), encoding="utf-8")
        (OUT / "notices.json").write_text(
            json.dumps(result.get("data", []), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        print(f"\n[OK] 공고명 {len(names)}건 추출")
        print(f"   - {OUT/'notices.txt'}")
        print(f"   - {OUT/'notices.json'}")
        print(f"   - {OUT/'raw_grid.json'}")

        time.sleep(3)
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
