"""검색 후 페이지에서 그리드 후보 ID들을 dump."""

from __future__ import annotations

import io
import json
import sys
import time
from pathlib import Path

from playwright.sync_api import TimeoutError as PWTimeout, sync_playwright

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

OUT = Path(__file__).parent / "out"
OUT.mkdir(exist_ok=True)


def main() -> int:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=False, args=["--start-maximized"])
        context = browser.new_context(viewport={"width": 1600, "height": 1000}, locale="ko-KR")
        page = context.new_page()

        print("[1] 접속")
        page.goto("https://www.g2b.go.kr/", wait_until="domcontentloaded", timeout=90000)
        try:
            page.wait_for_load_state("networkidle", timeout=60000)
        except PWTimeout:
            pass
        time.sleep(2)

        # 검색 흐름 동일
        print("[2] 공고명 채용 입력")
        for sel in ['input[id*="bidPbancNm"]:visible', 'input[title*="공고명"]:visible']:
            try:
                page.locator(sel).first.fill("채용", timeout=5000)
                break
            except Exception:
                continue

        print("[3] 검색 클릭")
        for sel in ['[id*="btnS0004"]:visible', 'button:has-text("검색"):visible']:
            try:
                page.locator(sel).first.click(timeout=3000)
                break
            except Exception:
                continue
        time.sleep(3)
        try:
            page.wait_for_load_state("networkidle", timeout=30000)
        except PWTimeout:
            pass

        print("[4] 100건 선택")
        try:
            page.locator(
                "#mf_wfm_container_tacBidPbancLst_contents_tab2_body_sbxRecordCountPerPage1"
            ).first.select_option("100")
        except Exception as e:
            print(f"  select 실패: {e}")
        time.sleep(3)

        print("[5] DOM 프로브")
        probe = page.evaluate(
            """() => {
                const report = {};

                // tab2 컨테이너 안의 가능한 그리드 후보들 (id에 'grd' 포함)
                const tabContainers = Array.from(document.querySelectorAll('[id*="tab2"]'));
                report.tab2Containers = tabContainers.length;

                // 모든 grd* ID 수집 (보이는 것만)
                const visibleGrids = Array.from(document.querySelectorAll('[id*="grd"]'))
                    .filter(el => el.offsetParent !== null)
                    .slice(0, 30)
                    .map(el => ({id: el.id, tag: el.tagName, classes: el.className}));
                report.visibleGrids = visibleGrids;

                // 보이는 테이블/리스트
                const visibleTables = Array.from(document.querySelectorAll('table, [id*="GridWrapElement"], [class*="w2grid"]'))
                    .filter(el => el.offsetParent !== null)
                    .slice(0, 20)
                    .map(el => ({id: el.id || '(no-id)', tag: el.tagName, classes: el.className.toString().slice(0, 120)}));
                report.visibleTables = visibleTables;

                // _cell_ 가 들어간 id 패턴 샘플 50개
                const cells = Array.from(document.querySelectorAll('[id*="_cell_"]'))
                    .filter(el => el.offsetParent !== null)
                    .slice(0, 50)
                    .map(el => el.id);
                report.cellSamples = cells;

                // 텍스트 '채용' 포함 보이는 노드 샘플
                const textNodes = [];
                document.querySelectorAll('*').forEach(el => {
                    if (textNodes.length >= 20) return;
                    if (el.children.length > 0) return;
                    const t = (el.innerText || '').trim();
                    if (t.length > 5 && t.length < 200 && t.includes('채용') && el.offsetParent !== null) {
                        textNodes.push({id: el.id || '(no-id)', tag: el.tagName, text: t.slice(0, 100)});
                    }
                });
                report.recruitTextSamples = textNodes;

                return report;
            }"""
        )

        (OUT / "probe.json").write_text(
            json.dumps(probe, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(json.dumps(probe, ensure_ascii=False, indent=2)[:5000])

        time.sleep(5)
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
