// 출퇴근 관리 — 메일플러그 그룹웨어 자동 진입
//
// 전략:
//   - 영구 user-data 디렉토리(USER_DATA_DIR) 사용 → 한 번 로그인 후 쿠키/세션 보존
//   - 1차: 페이지 진입 → 이미 로그인됐는지 확인 (로그인 form 없음 = 세션 살아있음)
//     * 살아있으면 → 출퇴근 페이지 자동 진입
//     * 아니면(첫 실행 또는 세션 만료):
//       - "setup" 모드일 때만: headful 로 열고 사용자가 직접 로그인(캡차 포함) 할 때까지 대기
//       - "auto" 모드인데 로그인 form 이 보이면 → 명확한 에러 (세션 다시 만들어야 함)
//
// 모드:
//   crawlAttendance({ mode: 'auto' })   — 자동 (세션 살아있어야 함)
//   crawlAttendance({ mode: 'setup' })  — 첫 세션 설정용. headful 강제. 최대 5분 수동 로그인 대기.
//
// 자격증명은 입력 안 함 (사용자 직접). MAILPLUG_USER_DATA_DIR 로 위치 override 가능.

import { chromium } from 'playwright';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import XLSX from 'xlsx';
import { getSecret, touchSecret, createAttendanceSnapshot } from './db.js';

// 엑셀 12컬럼 — 메일플러그가 3행에 박아주는 헤더 순서대로
const EXCEL_COLUMN_KEYS = [
  'date', 'name', 'emp_no', 'dept', 'position', 'work_type',
  'check_in_time', 'check_in_outside', 'check_out_time', 'check_out_outside',
  'commute_status', 'work_status',
];

function nowAsLocalDateTime() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function parseExcel(buf) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  // 1,2행은 메타/타이틀, 3행은 헤더, 4행부터 데이터
  // header:1 로 array-of-arrays. 3행을 헤더로 가정하지만 우리는 위치 매핑이라 헤더 텍스트 신경 X
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false });
  // 데이터는 index 3 부터 (0,1 = 타이틀, 2 = 헤더)
  const dataRows = aoa.slice(3);
  return dataRows
    .filter(r => Array.isArray(r) && r.some(v => v !== '' && v != null))
    .map(r => {
      const obj = {};
      for (let i = 0; i < EXCEL_COLUMN_KEYS.length; i++) {
        const v = r[i];
        obj[EXCEL_COLUMN_KEYS[i]] = v == null ? '' : String(v).trim();
      }
      return obj;
    });
}

const LOGIN_URL = 'https://gw.mailplug.com/';
const TARGET_URL = 'https://gw.mailplug.com/attendance/works/list/';

// Cookie 헤더 string → Playwright addCookies 형식 배열.
// 입력 허용 형태:
//   1) 깔끔한 라인:  "a=1; b=2; c=3"
//   2) prefix 포함:  "Cookie: a=1; b=2"  /  "cookie\na=1; b=2"
//   3) DevTools 헤더 dump 통째로:
//        ...
//        cookie
//        lang=kr; _ga_vid=...; MP_TAG=...
//        origin
//        https://gw.mailplug.com
//        ...
//      → 이 경우에도 cookie 라인의 값만 자동 추출
//   4) 줄바꿈/탭/다중공백 섞임 → normalize
function parseCookieHeader(raw, domains = ['gw.mailplug.com', '.mailplug.com']) {
  let s = String(raw || '');
  if (!s.trim()) return [];

  // (3) 헤더 dump 패턴 — "cookie" 헤더 다음 줄(들)의 값만 추출.
  //   다음 헤더(소문자 이름 + 줄바꿈 또는 ":") 또는 EOF 까지를 캡쳐.
  const dump = s.match(
    /(?:^|\n)\s*cookie\s*[:\n]+\s*([\s\S]*?)(?:\n\s*[A-Za-z][\w-]*\s*(?:[:\n]|$)|$)/i
  );
  if (dump && dump[1] && /=/.test(dump[1])) s = dump[1];

  // (2) prefix "Cookie:" 제거
  s = s.replace(/^\s*cookie\s*:\s*/i, '');

  // (4) 모든 공백류(줄바꿈/탭/다중공백) → 단일 공백 → trim
  s = s.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();

  // 세미콜론으로 분리 (앞뒤 공백 허용)
  const pairs = s.split(/\s*;\s*/).map(p => p.trim()).filter(Boolean);

  const cookies = [];
  const seen = new Set();
  for (const p of pairs) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    const name = p.slice(0, eq).trim();
    const value = p.slice(eq + 1).trim();
    if (!name || !value) continue;
    // 유효한 cookie name 만 (헤더 이름 같은 문자열은 자동 skip)
    if (!/^[A-Za-z0-9_!#$%&'*+\-.^`|~]+$/.test(name)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    for (const d of domains) {
      cookies.push({ name, value, domain: d, path: '/', httpOnly: false, secure: true });
    }
  }
  return cookies;
}

const USER_DATA_DIR = process.env.MAILPLUG_USER_DATA_DIR
  || path.join(os.tmpdir(), 'g2b-mailplug-profile');

function ensureDir(p) {
  try { fs.mkdirSync(p, { recursive: true }); } catch {}
}

// 로그인 폼이 화면에 있으면 세션 만료 / 첫 실행
async function isLoggedOut(page) {
  // 첫 단계 input 또는 비밀번호 input 이 보이면 로그인 화면
  const loc = page.locator('#login_input, input[type="password"]').first();
  return (await loc.count()) > 0;
}

// API 응답 JSON 안에서 "object 배열" 모음 — row 매칭 시도용
function collectArrayWithObjects(obj, out = [], depth = 0) {
  if (!obj || depth > 6) return out;
  if (Array.isArray(obj)) {
    if (obj.length > 0 && typeof obj[0] === 'object' && obj[0] !== null) out.push(obj);
    obj.forEach(v => collectArrayWithObjects(v, out, depth + 1));
  } else if (typeof obj === 'object') {
    Object.values(obj).forEach(v => collectArrayWithObjects(v, out, depth + 1));
  }
  return out;
}
// row item 에서 tooltip/상세 텍스트 가능한 필드 추출
function pickTooltipText(item) {
  if (!item || typeof item !== 'object') return null;
  const candidateKeys = [
    'status_detail', 'statusDetail', 'tooltip', 'tooltipText', 'tooltip_text',
    'description', 'desc', 'memo', 'comment', 'remark', 'note',
    'work_status_detail', 'workStatusDetail', 'detail', 'message',
  ];
  for (const k of candidateKeys) {
    if (typeof item[k] === 'string' && item[k].trim()) return item[k].trim();
  }
  return null;
}

// 쿠키 기반 모드 — DB 의 mailplug_cookies 값을 주입해서 페이지 접근. 캡차 우회.
export async function crawlAttendanceWithCookie() {
  const steps = [];
  const secret = await getSecret('mailplug_cookies');
  if (!secret || !secret.v) {
    throw new Error('쿠키가 등록되지 않았습니다. "쿠키 등록" 을 먼저 해주세요.');
  }
  steps.push(`1. 등록된 쿠키 사용 (updated_at=${secret.updated_at})`);

  const launchOpts = {
    headless: process.env.MAILPLUG_HEADLESS !== 'false',
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  };
  const chromePath = process.env.MAILPLUG_CHROME_PATH
    || process.env.PW_BROWSER_PATH
    || (process.platform === 'win32'
        ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
        : '/usr/bin/google-chrome');
  if (fs.existsSync(chromePath)) launchOpts.executablePath = chromePath;

  const browser = await chromium.launch(launchOpts);
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: 'ko-KR',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    const cookies = parseCookieHeader(secret.v);
    if (cookies.length === 0) throw new Error('쿠키 파싱 실패 — 값이 비어있거나 형식 오류');
    await ctx.addCookies(cookies);
    steps.push(`2. 쿠키 ${cookies.length / 2}개 주입`);

    const page = await ctx.newPage();

    // ─── API 응답 가로채기 — 메일플러그가 JSON 으로 보내는 데이터 수집 ───
    //   tooltip 텍스트가 보통 이 데이터에 포함되어 있어 hover 없이 추출 가능
    const apiResponses = [];
    page.on('response', async (res) => {
      try {
        const url = res.url();
        if (!/mailplug\.com/.test(url)) return;
        const ct = res.headers()['content-type'] || '';
        if (!/json/i.test(ct)) return;
        const data = await res.json().catch(() => null);
        if (!data) return;
        apiResponses.push({ url, status: res.status(), data });
      } catch {}
    });

    steps.push('3. 출퇴근 페이지 직접 진입');
    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);

    const url = page.url();
    const title = await page.title();
    steps.push(`4. URL=${url}, title="${title}"`);

    // 로그인 페이지로 redirect 되었으면 쿠키 만료
    if (
      /\/login/.test(url) ||
      (await page.locator('#login_input, input[type="password"]:visible').count()) > 0
    ) {
      throw new Error(
        '쿠키 만료 — 메일플러그 로그인 페이지로 redirect 됨. 쿠키를 다시 등록해주세요.'
      );
    }

    // ─── 페이지 사이즈 dropdown 10 → 100 ───
    steps.push('5. 페이지 사이즈 100 변경 시도');
    try {
      // 현재 값 "10" 인 dropdown 트리거 — CSS module class 라 partial 매칭
      const dd = page.locator('[class*="isDropdown"]').filter({ hasText: /^\s*10\s*/ }).first();
      const ddFallback = page.locator('[class*="isDropdown"]').first();
      const trigger = (await dd.count()) > 0 ? dd : ddFallback;
      await trigger.click({ timeout: 5000 });
      await page.waitForTimeout(300);
      // 옵션 "100" 클릭
      await page.locator('li, button, span, div')
        .filter({ hasText: /^\s*100\s*$/ })
        .first()
        .click({ timeout: 5000 });
      await page.waitForTimeout(1500); // 테이블 재로드
      steps.push('   ↳ 변경 완료');
    } catch (e) {
      steps.push(`   ↳ 페이지 사이즈 변경 실패 (계속 진행): ${e.message.slice(0, 80)}`);
    }

    // ─── 엑셀 다운로드 — 1,2행 스킵 + 12컬럼 위치 매핑 + 스냅샷 저장 ───
    steps.push('5.5. 엑셀 다운로드 시도');
    let excelRows = null;
    let excelFilename = null;
    let snapshotInfo = null;
    try {
      const dlBtn = page.getByText('다운로드', { exact: false }).first();
      await dlBtn.waitFor({ timeout: 8000, state: 'visible' });

      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        dlBtn.click({ force: true }),
      ]);

      excelFilename = download.suggestedFilename();
      const tmpPath = await download.path();
      if (!tmpPath) throw new Error('download.path() null — 다운로드 실패');
      const buf = await fs.promises.readFile(tmpPath);

      excelRows = parseExcel(buf);
      steps.push(`   ↳ ${excelFilename} — 3행부터 데이터 ${excelRows.length} 행`);

      // 스냅샷 저장 — 직원 매핑 + status_items 자동 분리
      const capturedAt = nowAsLocalDateTime();
      const saved = await createAttendanceSnapshot({
        capturedAt,
        excelFilename,
        note: null,
        rows: excelRows,
      });
      snapshotInfo = {
        id: saved.id,
        capturedAt,
        rowCount: saved.rowCount,
        skippedCount: saved.skippedCount,
        skippedNames: saved.skippedNames,
        statusItemCount: saved.statusItemCount,
        judgmentStats: saved.judgmentStats,
      };
      // 화면 테이블도 bid_employees 매칭된 행만 노출
      excelRows = saved.matchedRows;
      steps.push(
        `   ↳ 스냅샷 #${saved.id} 저장 — 매칭 ${saved.rowCount}행 / skip ${saved.skippedCount}행 / status items ${saved.statusItemCount}개`
      );
    } catch (e) {
      steps.push(`   ↳ 다운로드/저장 실패: ${e.message.slice(0, 120)}`);
    }

    await touchSecret('mailplug_cookies').catch(() => {});

    if (excelRows && excelRows.length > 0) {
      return {
        ok: true,
        mode: 'cookie',
        source: 'excel',
        steps,
        title,
        url,
        excelFilename,
        rowCount: excelRows.length,
        rows: excelRows, // 12개 키
        snapshot: snapshotInfo,
      };
    }

    // 엑셀 실패 시 fallback — 테이블 직접 스크래핑
    steps.push('   ↳ 엑셀 fallback → 테이블 스크래핑');

    // ─── 헤더 추출 + 사용자 요청 4컬럼(날짜·이름·출근시간·근무상태) 인덱스 매핑 ───
    const headerTexts = await page.locator('table thead th').evaluateAll(
      ths => ths.map(th => (th.textContent || '').trim())
    );
    steps.push(`6. 헤더(${headerTexts.length}): ${headerTexts.join(' | ')}`);

    const findColIdx = (kws) => {
      for (let i = 0; i < headerTexts.length; i++) {
        const h = headerTexts[i].replace(/\s+/g, '');
        for (const kw of kws) {
          if (h.includes(kw.replace(/\s+/g, ''))) return i;
        }
      }
      return -1;
    };
    const dateIdx    = findColIdx(['날짜', '일자']);
    const nameIdx    = findColIdx(['이름', '성명']);
    const checkInIdx = findColIdx(['출근시간', '출근']);
    const statusIdx  = findColIdx(['근무상태', '상태']);
    steps.push(`   ↳ idx — 날짜:${dateIdx} 이름:${nameIdx} 출근:${checkInIdx} 상태:${statusIdx}`);

    // ─── 행 raw 추출 (.sosok 제외) + 근무상태 셀의 정적 tooltip attribute ───
    const rawRows = await page.locator('table tbody tr').evaluateAll((trs, sIdx) => {
      return trs.map(tr => {
        const tds = Array.from(tr.querySelectorAll('td')).map(td => {
          const clone = td.cloneNode(true);
          clone.querySelectorAll('.sosok').forEach(el => el.remove());
          return (clone.textContent || '').trim().replace(/\s+/g, ' ');
        });
        const idx = sIdx >= 0 ? sIdx : (tds.length >= 7 ? 6 : Math.max(0, tds.length - 2));
        const statusCell = tr.querySelectorAll('td')[idx];
        const attrTooltip = statusCell
          ? (statusCell.getAttribute('title')
              || statusCell.getAttribute('aria-label')
              || statusCell.getAttribute('data-tooltip')
              || statusCell.querySelector('[title]')?.getAttribute('title')
              || null)
          : null;
        // 셀 내부 hidden 텍스트도 함께 수집 (display:none 으로 미리 박혀있는 tooltip 텍스트 후보)
        const hiddenTexts = [];
        if (statusCell) {
          statusCell.querySelectorAll('*').forEach(el => {
            const cs = window.getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') {
              const t = (el.textContent || '').trim();
              if (t && t.length <= 200) hiddenTexts.push(t);
            }
          });
        }
        return { cells: tds, attrTooltip, hiddenTexts };
      });
    }, statusIdx);
    steps.push(`7. ${rawRows.length} 행 추출`);

    // ─── 근무상태 tooltip — 우선순위로 탐색 ───
    //   1) cell attribute
    //   2) cell 내부 hidden 텍스트
    //   3) API 응답에서 매칭 (날짜/이름 키 사용)
    //   4) 마지막 fallback — hover (실패할 수도 있어 일부만 시도)
    function findInApi(rowIdx, row) {
      // attendance/works 관련 응답 안에서 i번째 row 와 매칭되는 객체 찾기
      for (const resp of apiResponses) {
        if (!/attendance|work/i.test(resp.url)) continue;
        const arr = collectArrayWithObjects(resp.data);
        for (const a of arr) {
          // 같은 길이의 배열에서 i번째
          if (Array.isArray(a) && a.length === rawRows.length) {
            const item = a[rowIdx];
            const tt = pickTooltipText(item);
            if (tt) return tt;
          }
        }
      }
      return null;
    }

    const rows = [];
    for (let i = 0; i < rawRows.length; i++) {
      const r = rawRows[i];
      let tooltip = r.attrTooltip;
      if (!tooltip && r.hiddenTexts.length > 0) {
        // 가장 긴 hidden 텍스트가 보통 tooltip 본문
        tooltip = r.hiddenTexts.sort((a, b) => b.length - a.length)[0];
      }
      if (!tooltip) {
        tooltip = findInApi(i, r) || null;
      }
      const out = {
        date:        dateIdx    >= 0 ? r.cells[dateIdx]    : '',
        name:        nameIdx    >= 0 ? r.cells[nameIdx]    : '',
        checkInTime: checkInIdx >= 0 ? r.cells[checkInIdx] : '',
        status:      statusIdx  >= 0 ? r.cells[statusIdx]  : '',
        statusDetail: tooltip,
        _raw: r.cells, // 디버깅용
      };
      rows.push(out);
    }
    steps.push(`8. tooltip 채워짐 ${rows.filter(r => r.statusDetail).length}/${rows.length}`);

    await touchSecret('mailplug_cookies').catch(() => {});

    return {
      ok: true,
      mode: 'cookie',
      source: 'scrape',
      steps,
      title,
      url,
      headers: headerTexts,
      rowCount: rows.length,
      rows,
      apiUrls: apiResponses.map(r => ({ url: r.url, status: r.status })),
      apiSample: apiResponses.length > 0
        ? { url: apiResponses[0].url, snippet: JSON.stringify(apiResponses[0].data).slice(0, 2000) }
        : null,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

export async function crawlAttendance({ mode = 'auto' } = {}) {
  // 쿠키 모드는 별도 함수
  if (mode === 'cookie') return crawlAttendanceWithCookie();

  ensureDir(USER_DATA_DIR);

  const headful = mode === 'setup' || process.env.MAILPLUG_HEADLESS === 'false';
  const launchOpts = {
    headless: !headful,
    // 자동화 탐지 우회 — chrome 의 기본 자동화 플래그 제거 + 시그널 마스킹
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
    viewport: { width: 1280, height: 800 },
    locale: 'ko-KR',
  };
  // 시스템 Chrome 우선 사용 (Playwright 번들 chromium 보다 봇 탐지 우회에 유리)
  const chromePath = process.env.MAILPLUG_CHROME_PATH
    || process.env.PW_BROWSER_PATH
    || (process.platform === 'win32'
        ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
        : '/usr/bin/google-chrome');
  if (fs.existsSync(chromePath)) launchOpts.executablePath = chromePath;

  const steps = [];
  steps.push(`mode=${mode}, headful=${headful}, userDataDir=${USER_DATA_DIR}`);

  const ctx = await chromium.launchPersistentContext(USER_DATA_DIR, launchOpts);
  try {
    // navigator.webdriver 흔적 제거
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.chrome = window.chrome || { runtime: {} };
    });

    const page = ctx.pages()[0] || await ctx.newPage();

    if (mode === 'setup') {
      // 자동 navigation 안 함 — 빈 크롬 창만 띄움. 사용자가 직접 주소 입력.
      steps.push('1. [setup] 빈 크롬 창 띄움 (about:blank). 직접 주소 치고 로그인하세요.');
      steps.push('   ↳ 작업 다 끝나면 창을 닫으면 쿠키 저장 + 종료됨. 최대 15분 대기.');

      // 종료 조건: (1) 사용자가 모든 창 닫음, (2) 15분 타임아웃
      const done = await Promise.race([
        new Promise(resolve => {
          ctx.once('close', () => resolve('context_closed'));
          page.once('close', () => {
            // 페이지가 한 개만 있고 닫혔다면 컨텍스트도 곧 close 됨
            setTimeout(() => resolve('page_closed'), 500);
          });
        }),
        new Promise(resolve => setTimeout(() => resolve('timeout_15m'), 15 * 60 * 1000)),
      ]);

      steps.push(`2. [setup] 종료 사유: ${done}`);

      return {
        ok: true,
        mode,
        steps,
        message: '브라우저 종료됨 — 쿠키는 영구 프로파일에 저장됨. 이제 "크롤 실행" 으로 확인해주세요.',
      };
    }

    // mode === 'auto'
    steps.push('1. 메일플러그 진입');
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(800);

    if (await isLoggedOut(page)) {
      throw new Error('세션이 없거나 만료됨. "세션 설정" 을 한 번 실행해서 직접 로그인해주세요.');
    }
    steps.push('2. 세션 살아있음 ✓');

    // 출퇴근 페이지 진입
    steps.push('3. 출퇴근 페이지 이동');
    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);

    if (await isLoggedOut(page)) {
      throw new Error('출퇴근 페이지에서 다시 로그인 화면이 떴음. 세션 설정을 다시 해주세요.');
    }

    const title = await page.title();
    const url = page.url();
    const bodyText = (await page.locator('body').innerText().catch(() => '')).slice(0, 1500);
    steps.push(`완료 — title="${title}", url=${url}`);

    return { ok: true, mode, steps, title, url, bodyText };
  } finally {
    await ctx.close().catch(() => {});
  }
}
