"""
PoC: 헤드리스 Playwright로 g2b 공고 상세 페이지에 진입해
첨부파일 다운로드(fileUpload.do POST 응답 binary)를 가로채는 시도.

성공/실패 모두 _debug/ 폴더에 결과를 남김:
- dlpoc_screenshots/*.png  : 단계별 스크린샷
- dlpoc_captured/*.bin     : 가로챈 binary
- dlpoc_log.txt            : 단계별 로그
"""

from __future__ import annotations

import asyncio
import io
import sys
import json
import time
from pathlib import Path

from playwright.async_api import async_playwright, TimeoutError as PWTimeout

# Windows UTF-8 콘솔
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

TARGET_BID = "R26BK01480852"
TARGET_ORD = "000"

ROOT = Path(__file__).parent
DEBUG = ROOT / "_debug"
SHOTS = DEBUG / "dlpoc_screenshots"
DUMPS = DEBUG / "dlpoc_captured"
SHOTS.mkdir(parents=True, exist_ok=True)
DUMPS.mkdir(parents=True, exist_ok=True)

log_lines: list[str] = []


def L(msg: str) -> None:
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    log_lines.append(line)


async def shot(page, name: str) -> None:
    try:
        await page.screenshot(path=str(SHOTS / f"{name}.png"), full_page=False)
        L(f"  📸 screenshot: {name}.png")
    except Exception as e:
        L(f"  ❌ screenshot fail: {e}")


async def main():
    # 캡처: fileUpload.do 응답
    captured: list[dict] = []

    async with async_playwright() as pw:
        L("== Playwright 시작 (headless) ==")
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
                url = resp.url
                if "fileUpload.do" in url or "fileDownload" in url:
                    body = await resp.body()
                    cd = resp.headers.get("content-disposition", "")
                    ct = resp.headers.get("content-type", "")
                    L(f"  🎯 가로챔: {url} ({len(body)}B, ct={ct[:40]}, cd={cd[:60]})")
                    captured.append({"url": url, "ct": ct, "cd": cd, "bytes": body})
            except Exception as e:
                L(f"  ⚠ response handler 에러: {e}")

        def on_request(req):
            if "fileUpload.do" in req.url or "fileDownload" in req.url:
                body = (req.post_data or "")[:200]
                L(f"  ⬆ 요청: {req.method} {req.url}  body={body}")

        page.on("response", on_response)
        page.on("request", on_request)

        # === 1단계: 홈페이지 진입 ===
        L("\n=== STEP 1: g2b 홈 진입 ===")
        try:
            await page.goto("https://www.g2b.go.kr/", wait_until="domcontentloaded", timeout=60_000)
            try:
                await page.wait_for_load_state("networkidle", timeout=15_000)
            except PWTimeout:
                pass
            await page.wait_for_timeout(3000)
            await shot(page, "01_home")
            L(f"  현재 URL: {page.url}")
            L(f"  title: {await page.title()}")
        except Exception as e:
            L(f"  ❌ 홈 진입 실패: {e}")
            await browser.close()
            return

        # === 2단계: 입찰공고 검색 페이지로 이동 시도 ===
        L("\n=== STEP 2: 입찰공고 목록 페이지로 이동 시도 (여러 URL 패턴) ===")
        candidate_urls = [
            f"https://www.g2b.go.kr/pn/pnp/pnpe/itembidpbac/itemBidPbancLstV.do",
            f"https://www.g2b.go.kr/index.do?bidPbancNo={TARGET_BID}&bidPbancOrd={TARGET_ORD}",
            f"https://www.g2b.go.kr/pn/pnp/pnpe/itembidpbac/itemAnncDtlV.do?bidPbancNo={TARGET_BID}&bidPbancOrd={TARGET_ORD}",
        ]
        loaded_url = None
        for i, url in enumerate(candidate_urls):
            L(f"  시도 {i + 1}/{len(candidate_urls)}: {url}")
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
                try:
                    await page.wait_for_load_state("networkidle", timeout=10_000)
                except PWTimeout:
                    pass
                await page.wait_for_timeout(2000)
                await shot(page, f"02_url_try_{i + 1}")
                cur = page.url
                title = await page.title()
                # 404나 에러 페이지 감지
                page_text = await page.evaluate("() => document.body ? document.body.innerText.slice(0, 200) : ''")
                L(f"    → URL: {cur}, title: {title}")
                L(f"    → body[:200]: {page_text[:200]!r}")
                if "오류" not in page_text and "Error" not in page_text and "찾을 수 없" not in page_text:
                    loaded_url = cur
                    L(f"    ✅ 이 URL이 정상 로드된 것 같음")
                    break
            except Exception as e:
                L(f"    ❌ {e}")

        if not loaded_url:
            L("  ❌ 모든 후보 URL 실패")

        # === 3단계: 페이지의 첨부파일 영역/다운로드 버튼 탐색 ===
        L("\n=== STEP 3: DOM에서 첨부파일 다운로드 버튼 탐색 ===")
        # 모든 frame을 돌면서 "다운로드" 텍스트나 첨부 파일 관련 그리드 찾기
        all_frames = page.frames
        L(f"  총 {len(all_frames)}개 frame 발견")
        for i, fr in enumerate(all_frames):
            try:
                furl = fr.url
                L(f"  [Frame {i}] {furl}")
                found = await fr.evaluate(
                    """
                    () => {
                      const r = { downloadBtns: [], gridFiles: [], grdFile: null };
                      // 다운로드 버튼 후보
                      const btns = Array.from(document.querySelectorAll('button, a, input[type=button]'));
                      for (const b of btns) {
                        const t = (b.innerText || b.value || '').trim();
                        if (/다운로드|download|첨부/i.test(t)) {
                          r.downloadBtns.push({
                            tag: b.tagName, text: t.slice(0, 30), id: b.id || null,
                            onclick: (b.getAttribute('onclick') || '').slice(0, 120),
                          });
                        }
                      }
                      // grdFile 그리드 존재 여부
                      const grdFile = document.getElementById('mf_wfm_container_mainWframe_grdFile');
                      if (grdFile) {
                        r.grdFile = {
                          id: grdFile.id,
                          rows: grdFile.querySelectorAll('tbody tr').length,
                        };
                      }
                      return r;
                    }
                    """
                )
                if found.get("downloadBtns"):
                    L(f"    다운로드 후보 {len(found['downloadBtns'])}개:")
                    for b in found["downloadBtns"][:10]:
                        L(f"      - {b}")
                if found.get("grdFile"):
                    L(f"    📂 grdFile 그리드 발견: {found['grdFile']}")
            except Exception as e:
                L(f"    ⚠ frame {i} probe 실패: {e}")

        # === 4단계: nexacro Application API로 메뉴 진입 시도 ===
        L("\n=== STEP 4: nexacro/WebSquare API로 공고 상세 진입 시도 ===")
        await page.goto("https://www.g2b.go.kr/", wait_until="domcontentloaded", timeout=30_000)
        try:
            await page.wait_for_load_state("networkidle", timeout=10_000)
        except PWTimeout:
            pass
        await page.wait_for_timeout(3000)

        nav_result = await page.evaluate(
            f"""
            async () => {{
              const r = {{ tried: [], success: null }};
              // WebSquare/nexacro API 후보
              const tries = [
                {{n: "WebSquare.goPage('PNPE027_01')",
                  f: () => window.WebSquare && WebSquare.goPage && WebSquare.goPage('PNPE027_01')}},
                {{n: "mf.gotoMenu('PNPE027_01')",
                  f: () => window.mf && mf.gotoMenu && mf.gotoMenu('PNPE027_01')}},
                {{n: "application.gotoMenu('PNPE027_01')",
                  f: () => window.application && application.gotoMenu && application.gotoMenu('PNPE027_01')}},
                {{n: "comUtil.gfnGotoMenu",
                  f: () => window.comUtil && comUtil.gfnGotoMenu && comUtil.gfnGotoMenu('PNPE027_01')}},
              ];
              for (const t of tries) {{
                try {{
                  const ret = await t.f();
                  r.tried.push(t.n + " → " + (ret === undefined ? "undefined" : String(ret).slice(0,60)));
                }} catch (e) {{
                  r.tried.push(t.n + " ERR: " + e.message);
                }}
              }}
              return r;
            }}
            """
        )
        L(f"  navigation API 시도 결과: {json.dumps(nav_result, ensure_ascii=False)}")
        await page.wait_for_timeout(3000)
        await shot(page, "04_after_navAPI")
        L(f"  현재 URL: {page.url}")

        # === 5단계: 캡처 결과 요약 ===
        L("\n=== STEP 5: 결과 요약 ===")
        L(f"  가로챈 fileUpload.do 응답: {len(captured)}건")
        for i, c in enumerate(captured):
            ext = "bin"
            cd = c["cd"]
            ct = c["ct"]
            if "pdf" in ct.lower() or ".pdf" in cd.lower():
                ext = "pdf"
            elif "hwp" in cd.lower():
                ext = "hwp"
            path = DUMPS / f"capture_{i + 1}.{ext}"
            path.write_bytes(c["bytes"])
            L(f"  → {path.name} ({len(c['bytes'])}B) saved")

        await browser.close()

    # 로그 저장
    (DEBUG / "dlpoc_log.txt").write_text("\n".join(log_lines), encoding="utf-8")
    L(f"\n✅ 종료. 로그는 _debug/dlpoc_log.txt")


if __name__ == "__main__":
    asyncio.run(main())
