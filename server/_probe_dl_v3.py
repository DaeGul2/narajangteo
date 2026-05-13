"""
PoC2: 사람처럼 메인 → 검색 → 결과 클릭 → 상세 → 첨부 클릭 흐름 시뮬레이션.

타깃: "한국벤처투자" 의 채용 대행 용역 공고 (사용자가 가장 최근 확인한 공고).
다운로드 클릭 시 페이지가 자체적으로 fileUpload.do POST를 3번 발생시킴 →
page.on("response") 로 가로채서 가장 큰 binary 응답을 파일로 저장.
"""

from __future__ import annotations

import asyncio
import io
import sys
import json
import time
from pathlib import Path

from playwright.async_api import async_playwright, TimeoutError as PWTimeout

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

SEARCH_KEYWORD = "한국벤처투자"

ROOT = Path(__file__).parent
DEBUG = ROOT / "_debug"
SHOTS = DEBUG / "dlpoc3_shots"
DUMPS = DEBUG / "dlpoc3_captured"
SHOTS.mkdir(parents=True, exist_ok=True)
DUMPS.mkdir(parents=True, exist_ok=True)

log_lines: list[str] = []


def L(msg: str) -> None:
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    log_lines.append(line)


async def shot(page, name: str) -> None:
    try:
        await page.screenshot(path=str(SHOTS / f"{name}.png"))
        L(f"  📸 {name}.png")
    except Exception as e:
        L(f"  ❌ shot err: {e}")


async def main():
    captured: list[dict] = []

    async with async_playwright() as pw:
        L("== Playwright launch (headless) ==")
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(
            viewport={"width": 1600, "height": 1000},
            locale="ko-KR",
            accept_downloads=True,
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
        )
        page = await ctx.new_page()

        async def on_response(resp):
            try:
                u = resp.url
                if "fileUpload.do" in u and "?raonk=" not in u:
                    body = await resp.body()
                    cd = resp.headers.get("content-disposition", "")
                    ct = resp.headers.get("content-type", "")
                    captured.append(
                        {"url": u, "ct": ct, "cd": cd, "size": len(body), "bytes": body}
                    )
                    L(f"  🎯 fileUpload.do 응답 #{len(captured)}: {len(body)}B ct={ct[:30]} cd={cd[:60]}")
            except Exception as e:
                L(f"  ⚠ resp err: {e}")

        def on_request(req):
            if "fileUpload.do" in req.url and "?raonk=" not in req.url:
                body = (req.post_data or "")[:80]
                L(f"  ⬆ fileUpload.do 요청: body[:80]={body}...")

        page.on("response", on_response)
        page.on("request", on_request)

        # === STEP 1 메인 진입 ===
        L("\n=== STEP 1: 메인 진입 ===")
        await page.goto("https://www.g2b.go.kr/", wait_until="domcontentloaded", timeout=60_000)
        try:
            await page.wait_for_load_state("networkidle", timeout=15_000)
        except PWTimeout:
            pass
        await page.wait_for_timeout(3000)
        await shot(page, "01_home")
        L(f"  URL: {page.url} | title: {await page.title()}")

        # === STEP 2 메인 검색 input 찾기 ===
        L("\n=== STEP 2: 메인 검색 input/버튼 DOM 탐색 ===")
        # 메인 페이지에 흔히 있는 통합 검색 input 후보
        inputs_info = await page.evaluate(
            """
            () => {
              const all = Array.from(document.querySelectorAll('input'));
              return all.map((el, idx) => ({
                idx, id: el.id, name: el.name, type: el.type,
                placeholder: el.placeholder, value: (el.value||'').slice(0,40),
                visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
                ariaLabel: el.getAttribute('aria-label'),
              })).filter(x => x.visible && (x.type === 'text' || x.type === 'search' || !x.type));
            }
            """
        )
        L(f"  검색 가능한 input {len(inputs_info)}개:")
        for ii in inputs_info[:20]:
            L(f"    {ii}")

        # === STEP 3 검색어 입력 후보 ===
        L("\n=== STEP 3: 검색어 입력 시도 ===")
        # 첫 번째 visible text input에 검색어 입력
        if inputs_info:
            tgt = inputs_info[0]
            sel = f"#{tgt['id']}" if tgt["id"] else f"input[type='text']"
            try:
                await page.fill(sel, SEARCH_KEYWORD)
                L(f"  ✅ 입력 시도 OK: selector={sel}")
                await shot(page, "03_after_fill")
            except Exception as e:
                L(f"  ❌ 입력 실패: {e}")
        else:
            L("  ❌ 검색 input 발견 안됨")

        # === STEP 4 검색 버튼 클릭 (Enter 키로 대체) ===
        L("\n=== STEP 4: Enter 키로 검색 시도 ===")
        try:
            if inputs_info:
                tgt = inputs_info[0]
                sel = f"#{tgt['id']}" if tgt["id"] else "input[type='text']"
                await page.press(sel, "Enter")
                L(f"  ✅ Enter 키 press OK")
            await page.wait_for_timeout(5000)
            await shot(page, "04_after_search")
            L(f"  검색 후 URL: {page.url}")
        except Exception as e:
            L(f"  ❌ Enter err: {e}")

        # === STEP 5 검색 결과 DOM 탐색 ===
        L("\n=== STEP 5: 결과 페이지 DOM 분석 ===")
        page_info = await page.evaluate(
            """
            () => {
              return {
                url: location.href,
                title: document.title,
                bodyText: document.body ? document.body.innerText.slice(0, 500) : '',
                tables: document.querySelectorAll('table').length,
                grids: document.querySelectorAll('.w2grid').length,
                rows: document.querySelectorAll('.w2grid tbody tr, table tbody tr').length,
                links: Array.from(document.querySelectorAll('a, td')).slice(0,40).map(a => ({
                  tag: a.tagName, text: (a.innerText||'').trim().slice(0,80),
                })).filter(x => x.text && x.text.length > 5).slice(0, 20),
              };
            }
            """
        )
        L(f"  URL: {page_info['url']}")
        L(f"  title: {page_info['title']}")
        L(f"  bodyText[:500]: {page_info['bodyText']!r}")
        L(f"  tables: {page_info['tables']}, grids: {page_info['grids']}, rows: {page_info['rows']}")
        L(f"  links/cells [{len(page_info['links'])}]:")
        for lk in page_info["links"][:20]:
            L(f"    {lk}")

        # === STEP 6 결과 행 클릭 시도 ===
        L("\n=== STEP 6: 검색 결과의 공고명 클릭 시도 ===")
        # 한국벤처투자 텍스트 포함 셀 클릭
        try:
            target = page.get_by_text("한국벤처투자", exact=False).first
            await target.click(timeout=10000)
            L("  ✅ '한국벤처투자' 텍스트 클릭 OK")
            await page.wait_for_timeout(5000)
            await shot(page, "06_after_row_click")
        except Exception as e:
            L(f"  ❌ 행 클릭 실패: {e}")

        L(f"  현재 URL: {page.url}")

        # === STEP 7 상세 페이지에서 첨부파일 영역 탐색 ===
        L("\n=== STEP 7: 첨부파일 영역 탐색 ===")
        detail_info = await page.evaluate(
            """
            () => {
              const r = {
                grdFile: null,
                fileLinks: [],
                hwpHits: [],
              };
              const grd = document.getElementById('mf_wfm_container_mainWframe_grdFile');
              if (grd) {
                r.grdFile = { rows: grd.querySelectorAll('tbody tr').length };
              }
              // .hwp .pdf 가 보이는 셀
              const cells = Array.from(document.querySelectorAll('td, a, span, button'));
              for (const c of cells) {
                const t = (c.innerText || '').trim();
                if (/\\.(hwp|hwpx|pdf|doc|docx|zip|xlsx)$/i.test(t)) {
                  r.hwpHits.push({
                    tag: c.tagName, text: t.slice(0, 100), id: c.id || null,
                  });
                }
              }
              return r;
            }
            """
        )
        L(f"  grdFile: {detail_info['grdFile']}")
        L(f"  파일명 패턴 셀 {len(detail_info['hwpHits'])}개:")
        for h in detail_info["hwpHits"][:15]:
            L(f"    {h}")

        # === STEP 8 첨부파일 첫 셀 클릭 ===
        L("\n=== STEP 8: 첨부파일 첫 셀 클릭 (다운로드 트리거 기대) ===")
        if detail_info.get("hwpHits"):
            try:
                first_name = detail_info["hwpHits"][0]["text"]
                L(f"  타깃 파일명: {first_name}")
                element = page.get_by_text(first_name, exact=False).first
                await element.click(timeout=10000)
                L("  ✅ 첨부 셀 클릭 OK")
                await page.wait_for_timeout(8000)  # 3-step protocol 완료까지
                await shot(page, "08_after_file_click")
            except Exception as e:
                L(f"  ❌ 첨부 클릭 실패: {e}")
        else:
            L("  ❌ 첨부 파일명 셀이 없어 시도 못 함")

        # === STEP 9 결과 ===
        L("\n=== STEP 9: 캡처 결과 ===")
        L(f"  총 fileUpload.do 응답: {len(captured)}개")
        if captured:
            captured.sort(key=lambda x: -x["size"])
            for i, c in enumerate(captured):
                ext = "bin"
                low = (c["cd"] + c["ct"]).lower()
                if "pdf" in low:
                    ext = "pdf"
                elif "hwpx" in low:
                    ext = "hwpx"
                elif "hwp" in low:
                    ext = "hwp"
                p = DUMPS / f"capture_{i + 1}_{c['size']}B.{ext}"
                p.write_bytes(c["bytes"])
                L(f"  → {p.name} (ct={c['ct'][:40]} cd={c['cd'][:60]})")

        await browser.close()

    (DEBUG / "dlpoc3_log.txt").write_text("\n".join(log_lines), encoding="utf-8")
    L("\n✅ 종료")


if __name__ == "__main__":
    asyncio.run(main())
