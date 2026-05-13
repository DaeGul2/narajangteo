// Playwright 자동화: 메인 → 검색 → 공고 클릭 → 첨부 클릭 → fileUpload.do body 캡처
// 캡처한 body 들을 fetch 로 replay 하여 binary 응답만 추려서 반환

import { chromium } from 'playwright';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';
const FILE_URL = 'https://www.g2b.go.kr/fs/fsc/fsca/fileUpload.do';

export async function automateDownload(bidNo, bidName) {
  const bodies = [];
  let cookies = {};
  const log = [];
  const D = (m) => { const line = `[zip] ${m}`; console.log(line); log.push(line); };

  try {
    D(`Playwright launch — bidNo=${JSON.stringify(bidNo)} name=${JSON.stringify(bidName)}`);
    const browser = await chromium.launch({ headless: true });
    try {
      const ctx = await browser.newContext({
        viewport: { width: 1600, height: 1000 },
        locale: 'ko-KR',
        userAgent: UA,
      });
      const page = await ctx.newPage();

      page.on('request', (req) => {
        try {
          const u = req.url();
          if (!u.includes('fileUpload.do') || u.includes('?raonk=')) return;
          const body = req.postData() || '';
          if (body.startsWith('k01=')) bodies.push(body);
        } catch (_) {}
      });

      // 1) 메인 진입
      await page.goto('https://www.g2b.go.kr/', { waitUntil: 'domcontentloaded', timeout: 60000 });
      try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch (_) {}
      await page.waitForTimeout(4000);

      // 2) 메인 영역 검색 input 찾기 (GNB 통합검색 제외)
      const searchSel = await page.evaluate(() => {
        const cand = Array.from(document.querySelectorAll('input[type=text]'));
        for (const el of cand) {
          const r = el.getBoundingClientRect();
          const vis = r.width > 100 && r.height > 16 && el.offsetParent !== null;
          if (vis && (el.placeholder || '').trim() === '입찰공고') return '#' + el.id;
        }
        for (const el of cand) {
          const r = el.getBoundingClientRect();
          const vis = r.width > 100 && r.height > 16 && el.offsetParent !== null;
          if (vis && (el.placeholder || '').includes('입찰공고')) return '#' + el.id;
        }
        return null;
      });
      if (!searchSel) throw new Error('검색 input 발견 실패');
      D(`검색 input: ${searchSel}`);

      // 3) 검색 — 공고명 우선
      const keyword = (bidName || '').trim() || (bidNo || '').split('-')[0];
      if (!keyword) throw new Error('검색 키워드 없음');
      await page.fill(searchSel, keyword);
      await page.press(searchSel, 'Enter');
      await page.waitForTimeout(7000);
      D(`검색 완료 (keyword=${JSON.stringify(keyword)})`);

      // 4) 공고 행 클릭 — 폴백 chain
      const candidates = [];
      if (bidName) {
        const parts = bidName.split(/\s+/);
        if (parts[0]) candidates.push(parts[0]);
        if (parts[1]) candidates.push(parts[1]);
      }
      if (bidNo) candidates.push(bidNo.split('-')[0]);

      let clicked = false;
      for (const ct of candidates) {
        try {
          const target = page.getByText(ct, { exact: false }).first();
          await target.scrollIntoViewIfNeeded({ timeout: 8000 });
          await target.click({ timeout: 8000 });
          D(`공고 클릭 OK (${JSON.stringify(ct)})`);
          clicked = true;
          break;
        } catch (e) {
          D(`클릭 시도 실패 (${JSON.stringify(ct)}): ${e.name || 'Error'}`);
        }
      }
      if (!clicked) {
        const fbId = await page.evaluate(() => {
          for (const td of document.querySelectorAll('td')) {
            const t = (td.innerText || '').trim();
            if (t.length > 8 && t.length < 200 && /[가-힣]/.test(t) && !/^\d{4}-\d{2}/.test(t)) {
              return td.id || null;
            }
          }
          return null;
        });
        if (fbId) {
          try {
            await page.click('#' + fbId, { timeout: 10000 });
            D(`폴백 셀 클릭 OK (#${fbId})`);
            clicked = true;
          } catch (e) {
            D(`폴백 클릭 실패: ${e.message}`);
          }
        }
      }
      if (!clicked) throw new Error('공고 클릭 모든 후보 실패');
      await page.waitForTimeout(7000);

      // 5) 첨부 파일 셀 enum
      const fileCells = await page.evaluate(() => {
        const out = [];
        for (const td of document.querySelectorAll('td')) {
          const t = (td.innerText || '').trim();
          if (/\.(hwp|hwpx|pdf|doc|docx|zip|xlsx)$/i.test(t) && t.length < 200) {
            out.push(t);
          }
        }
        return out;
      });
      D(`첨부 파일 셀 ${fileCells.length}개: ${JSON.stringify(fileCells)}`);

      // 6) 각 파일 순차 클릭
      for (let i = 0; i < fileCells.length; i++) {
        const fname = fileCells[i];
        const before = bodies.length;
        try {
          const el = page.getByText(fname, { exact: false }).first();
          await el.scrollIntoViewIfNeeded({ timeout: 5000 });
          await el.click({ timeout: 8000 });
          await page.waitForTimeout(8000);
          D(`[${i + 1}/${fileCells.length}] ${fname} → +${bodies.length - before} bodies`);
        } catch (e) {
          D(`[${i + 1}/${fileCells.length}] 클릭 실패: ${e.message}`);
        }
      }

      const ck = await ctx.cookies();
      cookies = Object.fromEntries(ck.map(c => [c.name, c.value]));
    } finally {
      await browser.close();
    }
  } catch (e) {
    D(`FATAL: ${e.name || 'Error'}: ${e.message}`);
  }

  // 7) httpx 대신 fetch 로 replay → binary 응답만 저장
  const headers = {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'ko,en-US;q=0.9,en;q=0.8',
    'Cache-Control': 'max-age=0',
    'Content-Type': 'application/x-www-form-urlencoded',
    Origin: 'https://www.g2b.go.kr',
    Referer: 'https://www.g2b.go.kr/',
    'Sec-Fetch-Dest': 'iframe',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'User-Agent': UA,
    Cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; '),
  };
  const results = [];
  for (const body of bodies) {
    let res;
    try {
      res = await fetch(FILE_URL, { method: 'POST', headers, body });
    } catch (e) { continue; }
    const cd = res.headers.get('content-disposition') || '';
    const buf = Buffer.from(await res.arrayBuffer());
    const hexHead = buf.slice(0, 8).toString('hex');
    const isBin = /filename/i.test(cd) ||
      hexHead.startsWith('d0cf11e0') ||
      hexHead.startsWith('504b0304') ||
      hexHead.startsWith('25504446') ||
      hexHead.startsWith('ffd8ff') ||
      hexHead.startsWith('89504e47');
    if (!isBin) continue;
    let name = '';
    const m = cd.match(/filename="([^"]+)"/);
    if (m) {
      try { name = decodeURIComponent(m[1]); } catch (_) { name = m[1]; }
    }
    if (!name) {
      const ext =
        hexHead.startsWith('d0cf11e0') ? '.hwp' :
        hexHead.startsWith('504b0304') ? '.hwpx' :
        hexHead.startsWith('25504446') ? '.pdf' : '.bin';
      name = `file_${results.length + 1}${ext}`;
    }
    results.push({ name, bytes: buf });
  }
  D(`fetch 다운로드 완료: ${results.length}개 binary 응답`);
  return { files: results, log };
}
