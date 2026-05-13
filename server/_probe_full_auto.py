"""
PoC v4 — 풀 자동화:
메인 → 입찰공고 검색 → 공고명 클릭 → 상세 → 첨부 클릭
→ fileUpload.do(iframe navigation) 응답 가로채서 binary 저장.

타깃 키워드: 한국벤처투자 채용 대행 용역
"""
from __future__ import annotations
import asyncio, io, sys, time, json
from pathlib import Path
from urllib.parse import unquote
from playwright.async_api import async_playwright, TimeoutError as PWTimeout

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEYWORD = "한국벤처투자 채용"
ROOT = Path(__file__).parent
DEBUG = ROOT / "_debug" / "full_auto"
SHOTS = DEBUG / "shots"
DUMPS = DEBUG / "files"
SHOTS.mkdir(parents=True, exist_ok=True)
DUMPS.mkdir(parents=True, exist_ok=True)

log_lines: list[str] = []


def L(m: str) -> None:
    line = f"[{time.strftime('%H:%M:%S')}] {m}"
    print(line, flush=True)
    log_lines.append(line)


async def shot(page, name: str) -> None:
    try:
        await page.screenshot(path=str(SHOTS / f"{name}.png"))
        L(f"  📸 {name}.png")
    except Exception as e:
        L(f"  shot err: {e}")


async def main() -> None:
    captured_files: list[dict] = []

    async with async_playwright() as pw:
        L("== launch headless ==")
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(
            viewport={"width": 1600, "height": 1000},
            locale="ko-KR",
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
            ),
        )
        page = await ctx.new_page()

        # 응답 캡처: fileUpload.do 중 binary 인 것만 (크기/CT 기준)
        async def on_response(resp):
            try:
                u = resp.url
                if "fileUpload.do" not in u:
                    return
                if "?raonk=" in u:
                    return
                cd = resp.headers.get("content-disposition", "")
                ct = resp.headers.get("content-type", "")
                cl = int(resp.headers.get("content-length", "0") or 0)
                # binary 후보: content-disposition 에 filename 있거나, 큰 응답
                is_bin = "attachment" in cd.lower() or "filename" in cd.lower()
                if not is_bin and cl < 5000:
                    L(f"  ⚪ skip (text-like): {cl}B ct={ct[:30]} cd={cd[:60]}")
                    return
                body = await resp.body()
                L(f"  🎯 binary 응답: {len(body)}B ct={ct[:40]} cd={cd[:120]}")
                captured_files.append({"url": u, "ct": ct, "cd": cd, "bytes": body})
            except Exception as e:
                L(f"  resp err: {e}")

        page.on("response", on_response)

        # ─── STEP 1: 메인 ───
        L("\n=== STEP 1: 메인 진입 ===")
        await page.goto("https://www.g2b.go.kr/", wait_until="domcontentloaded", timeout=60_000)
        try:
            await page.wait_for_load_state("networkidle", timeout=15_000)
        except PWTimeout:
            pass
        await page.wait_for_timeout(4000)
        await shot(page, "01_home")
        L(f"  URL: {page.url}, title: {await page.title()}")

        # 메인의 통합 검색 input 찾기
        # 메인 페이지에서 보이는 모든 input + 그 주변 텍스트 dump
        inputs = await page.evaluate(
            """
            () => {
              const arr = [];
              for (const el of document.querySelectorAll('input')) {
                const r = el.getBoundingClientRect();
                if (r.width < 80 || r.height < 16) continue;  // 너무 작은 거 제외
                arr.push({
                  id: el.id, name: el.name, type: el.type || 'text',
                  placeholder: el.placeholder || '', value: (el.value||'').slice(0,40),
                  w: r.width, h: r.height, x: r.x, y: r.y,
                  ariaLabel: el.getAttribute('aria-label') || '',
                });
              }
              return arr;
            }
            """
        )
        L(f"  검색 후보 input {len(inputs)}개:")
        for i in inputs[:15]:
            L(f"    {i}")

        # 가장 그럴듯한 검색 input 선정: 너비가 큰 것 + placeholder/aria에 검색 키워드
        target_input = None
        for i in inputs:
            txt = (i["placeholder"] + " " + i["ariaLabel"]).lower()
            if any(k in txt for k in ("검색", "search", "조회", "공고")):
                target_input = i
                L(f"  ✅ 검색 input 추정: {i}")
                break
        if not target_input and inputs:
            # 가장 너비 큰 거
            target_input = max(inputs, key=lambda x: x["w"])
            L(f"  ⚠ placeholder 매칭 실패, 가장 큰 input 사용: {target_input}")

        # ─── STEP 2: 검색어 입력 + Enter ───
        L("\n=== STEP 2: 검색 ===")
        if target_input:
            sel = f"#{target_input['id']}" if target_input["id"] else None
            try:
                if sel:
                    await page.fill(sel, KEYWORD)
                    await page.press(sel, "Enter")
                    L(f"  ✅ '{KEYWORD}' 입력 + Enter")
                await page.wait_for_timeout(8000)
                await shot(page, "02_after_search")
                L(f"  URL: {page.url}")
            except Exception as e:
                L(f"  ❌ 검색 실패: {e}")

        # ─── STEP 3: 결과 페이지 분석 + 공고명 찾기 ───
        L("\n=== STEP 3: 결과 페이지 분석 ===")
        result_info = await page.evaluate(
            """
            (kw) => {
              const r = { url: location.href, hits: [] };
              const all = Array.from(document.querySelectorAll('td, a, span, div, button'));
              for (const el of all) {
                const t = (el.innerText || '').trim();
                if (t.length > 5 && t.length < 200 && t.includes(kw.split(' ')[0])) {
                  r.hits.push({tag: el.tagName, text: t.slice(0, 120), id: el.id || ''});
                  if (r.hits.length > 30) break;
                }
              }
              return r;
            }
            """,
            KEYWORD,
        )
        L(f"  URL: {result_info['url']}")
        L(f"  키워드 매칭 후보 {len(result_info['hits'])}개:")
        for h in result_info["hits"][:15]:
            L(f"    {h}")

        # ─── STEP 4: 공고명 클릭 ───
        L("\n=== STEP 4: 공고명 클릭 ===")
        try:
            target = page.get_by_text("한국벤처투자", exact=False).first
            await target.scroll_into_view_if_needed(timeout=5000)
            await target.click(timeout=10000)
            L("  ✅ 한국벤처투자 클릭")
            await page.wait_for_timeout(7000)
            await shot(page, "04_after_row_click")
        except Exception as e:
            L(f"  ❌ 행 클릭 실패: {e}")

        L(f"  현재 URL: {page.url}")

        # ─── STEP 5: 상세 페이지 진입 확인 + 첨부 파일 영역 탐색 ───
        L("\n=== STEP 5: 상세 페이지 / 첨부 파일 영역 ===")
        detail = await page.evaluate(
            """
            () => {
              const grd = document.getElementById('mf_wfm_container_mainWframe_grdFile');
              const r = { grdFile: null, hwpHits: [] };
              if (grd) r.grdFile = { rows: grd.querySelectorAll('tbody tr').length };
              for (const c of document.querySelectorAll('td, a, span, nobr')) {
                const t = (c.innerText || '').trim();
                if (t.length > 4 && /\\.(hwp|hwpx|pdf|doc|docx|zip|xlsx)$/i.test(t)) {
                  r.hwpHits.push({tag: c.tagName, text: t.slice(0, 120), id: c.id || ''});
                  if (r.hwpHits.length > 20) break;
                }
              }
              return r;
            }
            """
        )
        L(f"  grdFile: {detail['grdFile']}")
        L(f"  파일명 셀 {len(detail['hwpHits'])}개:")
        for h in detail["hwpHits"]:
            L(f"    {h}")

        # ─── STEP 6: 첨부 파일 클릭 ───
        L("\n=== STEP 6: 첨부 파일 클릭 (binary 응답 캡처 기대) ===")
        if detail["hwpHits"]:
            fname = detail["hwpHits"][0]["text"]
            L(f"  타깃: {fname}")
            try:
                t = page.get_by_text(fname, exact=False).first
                await t.scroll_into_view_if_needed(timeout=5000)
                await t.click(timeout=10000)
                L("  ✅ 파일명 클릭 완료. 응답 대기 12초")
                await page.wait_for_timeout(12000)
                await shot(page, "06_after_file_click")
            except Exception as e:
                L(f"  ❌ 파일 클릭 실패: {e}")
        else:
            L("  ❌ 첨부파일 셀 없음 → 상세 페이지 진입 실패 가능성")

        await browser.close()

    # ─── 결과 ───
    L(f"\n=== 결과: binary 응답 {len(captured_files)}개 ===")
    for i, c in enumerate(captured_files, 1):
        cd = c["cd"]
        name = ""
        # filename="..."  파싱
        import re as _re
        m = _re.search(r'filename="([^"]+)"', cd)
        if m:
            name = unquote(m.group(1))
        ext = ".bin"
        h = c["bytes"][:8].hex()
        if h.startswith("d0cf11e0"):
            ext = ".hwp"
        elif h.startswith("504b0304"):
            ext = ".hwpx"
        elif h.startswith("25504446"):
            ext = ".pdf"
        save = DUMPS / (name or f"file_{i}{ext}")
        save.write_bytes(c["bytes"])
        L(f"  → {save.name} ({len(c['bytes'])}B)")

    (DEBUG / "log.txt").write_text("\n".join(log_lines), encoding="utf-8")
    L("\n✅ 종료")


if __name__ == "__main__":
    asyncio.run(main())
