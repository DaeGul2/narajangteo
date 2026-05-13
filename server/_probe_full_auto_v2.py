"""
PoC v5 — 풀 자동화 (최종):
Playwright 로 메인 → 검색 → 공고 클릭 → 상세 → 첨부 클릭 흐름까지 수행.
4번째 iframe-navigation fileUpload.do 요청의 body(k01) 만 가로챔 →
같은 컨텍스트의 쿠키로 httpx 가 그 body 를 그대로 POST → binary 응답으로 파일 저장.

여러 파일 다운로드 가능하게 모든 첨부를 순차 클릭.
"""
from __future__ import annotations
import asyncio, io, sys, time, re
from pathlib import Path
from urllib.parse import unquote
import httpx
from playwright.async_api import async_playwright, TimeoutError as PWTimeout

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEYWORD = "한국벤처투자 채용"
ROOT = Path(__file__).parent
DEBUG = ROOT / "_debug" / "full_auto_v2"
DUMPS = DEBUG / "files"
SHOTS = DEBUG / "shots"
DUMPS.mkdir(parents=True, exist_ok=True)
SHOTS.mkdir(parents=True, exist_ok=True)


def L(m: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)


async def shot(page, name: str) -> None:
    try:
        await page.screenshot(path=str(SHOTS / f"{name}.png"))
    except Exception:
        pass


async def main() -> None:
    # 캡처: iframe navigation fileUpload.do 요청의 body 모음
    iframe_nav_bodies: list[str] = []

    async with async_playwright() as pw:
        L("== Playwright launch ==")
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

        def on_request(req):
            try:
                if "fileUpload.do" not in req.url or "?raonk=" in req.url:
                    return
                body = req.post_data or ""
                if body.startswith("k01="):
                    iframe_nav_bodies.append(body)
            except Exception as e:
                L(f"  req err: {e}")

        page.on("request", on_request)

        # ─ STEP 1 메인 진입
        await page.goto("https://www.g2b.go.kr/", wait_until="domcontentloaded", timeout=60_000)
        try:
            await page.wait_for_load_state("networkidle", timeout=15_000)
        except PWTimeout:
            pass
        await page.wait_for_timeout(4000)
        await shot(page, "01_home")

        # ─ STEP 2 검색
        # 메인 영역의 visible 한 '입찰공고' 검색 input 찾기 (GNB 통합검색 제외)
        search_sel = await page.evaluate(
            """
            () => {
              const cand = Array.from(document.querySelectorAll('input[type=text]'));
              // 정확히 placeholder == '입찰공고' + visible
              for (const el of cand) {
                const r = el.getBoundingClientRect();
                const vis = r.width > 100 && r.height > 16 && el.offsetParent !== null;
                if (vis && (el.placeholder||'').trim() === '입찰공고') {
                  return '#' + el.id;
                }
              }
              // fallback: visible + placeholder 에 '입찰공고' 포함
              for (const el of cand) {
                const r = el.getBoundingClientRect();
                const vis = r.width > 100 && r.height > 16 && el.offsetParent !== null;
                if (vis && (el.placeholder||'').includes('입찰공고')) {
                  return '#' + el.id;
                }
              }
              return null;
            }
            """
        )
        L(f"  검색 input selector: {search_sel}")
        if not search_sel:
            L("  ❌ 검색 input 없음")
            await browser.close()
            return
        await page.fill(search_sel, KEYWORD)
        await page.press(search_sel, "Enter")
        await page.wait_for_timeout(7000)
        await shot(page, "02_after_search")
        L("  ✅ 검색 완료")

        # ─ STEP 3 공고 클릭
        try:
            target = page.get_by_text("한국벤처투자", exact=False).first
            await target.scroll_into_view_if_needed(timeout=5000)
            await target.click(timeout=10000)
            await page.wait_for_timeout(7000)
            await shot(page, "03_after_row_click")
            L("  ✅ 공고 클릭 완료")
        except Exception as e:
            L(f"  ❌ 공고 클릭 실패: {e}")
            await browser.close()
            return

        # ─ STEP 4 첨부 파일 셀들 enum
        files = await page.evaluate(
            """
            () => {
              const out = [];
              for (const td of document.querySelectorAll('td')) {
                const t = (td.innerText||'').trim();
                if (/\\.(hwp|hwpx|pdf|doc|docx|zip|xlsx)$/i.test(t) && t.length < 200) {
                  out.push({text: t, id: td.id});
                }
              }
              return out;
            }
            """
        )
        L(f"  📂 첨부 파일 셀 {len(files)}개")
        for f in files:
            L(f"    - {f['text']}")

        # ─ STEP 5 각 파일 순차 클릭, body 누적
        for i, f in enumerate(files):
            L(f"\n  [{i + 1}/{len(files)}] '{f['text']}' 클릭")
            before = len(iframe_nav_bodies)
            try:
                # 텍스트 노드 클릭 (td.id 클릭은 다운로드 트리거 안 됨)
                el = page.get_by_text(f["text"], exact=False).first
                await el.scroll_into_view_if_needed(timeout=5000)
                await el.click(timeout=8000)
                # 3 XHR 핸드셰이크 + 4번째 iframe-nav 발생까지 10초 대기
                await page.wait_for_timeout(10000)
                after = len(iframe_nav_bodies)
                L(f"    +{after - before} iframe-nav body 캡처됨 (총 {after})")
            except Exception as e:
                L(f"    ❌ 클릭 실패: {e}")

        # 쿠키 추출
        ck_list = await ctx.cookies()
        cookies = {c["name"]: c["value"] for c in ck_list}
        await browser.close()

    # ─ STEP 6 httpx 로 모든 body 시도, binary 응답만 저장
    L(f"\n=== STEP 6: 총 {len(iframe_nav_bodies)}개 body httpx 호출, binary 응답만 저장 ===")
    URL = "https://www.g2b.go.kr/fs/fsc/fsca/fileUpload.do"
    H = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "ko,en-US;q=0.9,en;q=0.8",
        "Cache-Control": "max-age=0",
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": "https://www.g2b.go.kr",
        "Referer": "https://www.g2b.go.kr/",
        "Sec-Fetch-Dest": "iframe",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    }
    saved_count = 0
    with httpx.Client(cookies=cookies, headers=H, timeout=60, follow_redirects=True) as c:
        for i, body in enumerate(iframe_nav_bodies, 1):
            try:
                r = c.post(URL, content=body)
            except Exception as e:
                L(f"  [{i}/{len(iframe_nav_bodies)}] ❌ {e}")
                continue
            cd = r.headers.get("content-disposition", "")
            ct = r.headers.get("content-type", "")
            size = len(r.content)
            # binary 식별: content-disposition 에 filename 있거나, 큰 응답 + binary 시그니처
            h = r.content[:8].hex()
            is_bin = (
                "filename" in cd.lower()
                or h.startswith(("d0cf11e0", "504b0304", "25504446", "ffd8ff", "89504e47"))
            )
            if not is_bin:
                L(f"  [{i}/{len(iframe_nav_bodies)}] skip text {size}B ct={ct[:30]}")
                continue
            name = ""
            m = re.search(r'filename="([^"]+)"', cd)
            if m:
                name = unquote(m.group(1))
            ext = ".bin"
            if h.startswith("d0cf11e0"):
                ext = ".hwp"
            elif h.startswith("504b0304"):
                ext = ".hwpx"
            elif h.startswith("25504446"):
                ext = ".pdf"
            fn = name or f"file_{i}{ext}"
            p = DUMPS / fn
            p.write_bytes(r.content)
            saved_count += 1
            L(f"  [{i}/{len(iframe_nav_bodies)}] ✅ {r.status_code} {size}B → {fn}")

    L(f"\n🎉 총 {saved_count}개 파일 저장 완료")

    L("\n✅ 종료")


if __name__ == "__main__":
    asyncio.run(main())
