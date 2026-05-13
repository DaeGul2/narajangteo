// g2b.go.kr API 직접 호출 — 검색/상세/첨부 리스트
// Python 버전과 동일한 URL/헤더/payload

import { chromium } from 'playwright';
import { browserLaunchOpts } from './utils.js';

const SEARCH_URL = 'https://www.g2b.go.kr/pn/pnp/pnpe/BidPbac/selectBidPbacScrollTypeList.do';
const DETAIL_URL = 'https://www.g2b.go.kr/pn/pnp/pnpe/ItemBidPbac/selectItemAnncMngV.do';
const ATCH_FILE_LIST_URL = 'https://www.g2b.go.kr/fs/fsc/fscb/UntyAtchFile/selectUntyAtchFileList.do';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const DEFAULT_HEADERS = {
  Accept: 'application/json',
  'Accept-Language': 'ko,en-US;q=0.9,en;q=0.8',
  'Content-Type': 'application/json;charset=UTF-8',
  Origin: 'https://www.g2b.go.kr',
  Referer: 'https://www.g2b.go.kr/',
  'User-Agent': UA,
  'Menu-Info': '{"menuNo":"01175","menuCangVal":"PNPE001_01","bsneClsfCd":"%EC%97%85130026","scrnNo":"00941"}',
  'Target-Id': 'btnS0004',
  submissionid: 'mf_wfm_container_tacBidPbancLst_contents_tab2_body_sbmPbancBidPbancLst',
  'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not_A Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
};

const DETAIL_HEADERS = {
  ...DEFAULT_HEADERS,
  'Menu-Info': '{"menuNo":"01196","menuCangVal":"PNPE027_01","bsneClsfCd":"%EC%97%85130026","scrnNo":"06085"}',
  'Usr-Id': 'UN00000120665',
  submissionid: 'mf_wfm_container_mainWframe_selectItemAnncMngV',
};

// ─────────────────────────────────────────────────────────────
// Playwright 헤드리스로 세션 쿠키 1회 수집 (캐시)
// ─────────────────────────────────────────────────────────────
let _cachedCookies = null;

export async function getSessionCookies(force = false) {
  if (_cachedCookies && !force) return _cachedCookies;
  console.log('[cookie] 헤드리스 브라우저로 g2b.go.kr 쿠키 수집');
  const browser = await chromium.launch(browserLaunchOpts());
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
      locale: 'ko-KR',
      userAgent: UA,
    });
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    const page = await ctx.newPage();
    await page.goto('https://www.g2b.go.kr/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    try {
      await page.waitForLoadState('networkidle', { timeout: 20000 });
    } catch (_) {}
    await page.waitForTimeout(3000);
    const cookies = await ctx.cookies();
    _cachedCookies = Object.fromEntries(cookies.map(c => [c.name, c.value]));
    console.log(`[cookie] 수집된 쿠키 ${Object.keys(_cachedCookies).length}개`);
    return _cachedCookies;
  } finally {
    await browser.close();
  }
}

function cookieHeader(cookies) {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

// ─────────────────────────────────────────────────────────────
// 검색 API
// ─────────────────────────────────────────────────────────────
function buildSearchPayload(keyword, count, daysBack) {
  const today = new Date();
  const fmt = (d) => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const toDt = fmt(today);
  const from = new Date(today.getTime() - daysBack * 24 * 60 * 60 * 1000);
  const fromDt = fmt(from);
  return {
    dlBidPbancLstM: {
      untyBidPbancNo: '', bidPbancNo: '', bidPbancOrd: '', prcmBsneUntyNoOrd: '',
      prcmBsneSeCd: '0000 조070001 조070002 조070003 조070004 조070005 민079999',
      bidPbancNm: keyword,
      pbancPstgDt: '', ldocNoVal: '', bidPrspPrce: '', ctrtDmndRcptNo: '',
      dmstcOvrsSeCd: '', pbancKndCd: '공440002', ctrtTyCd: '', bidCtrtMthdCd: '',
      scsbdMthdCd: '', fromBidDt: fromDt, toBidDt: toDt,
      minBidPrspPrce: '', maxBidPrspPrce: '',
      bsneAllYn: 'Y', frcpYn: 'Y', rsrvYn: 'Y', laseYn: 'Y',
      untyGrpGb: '', dmstNm: '', pbancPicNm: '',
      odnLmtLgdngCd: '', odnLmtLgdngNm: '', intpCd: '', intpNm: '',
      dtlsPrnmNo: '', dtlsPrnmNm: '',
      slprRcptDdlnYn: '', lcrtTyCd: '', isMas: '', isElpdt: '',
      oderInstUntyGrpNo: '', instSearchRangeYn: '', esdacYn: '',
      infoSysCd: '정010029', contxtSeCd: '콘010006',
      bidDateType: 'R', brcoOrgnCd: '', deptOrgnCd: '',
      isShop: '', srchTy: '0', cangParmVal: '',
      currentPage: '', recordCountPerPage: String(count),
      startIndex: 1, endIndex: count,
    },
  };
}

export async function callSearchApi(keyword = '채용', count = 100, daysBack = 30, retry = true) {
  const cookies = await getSessionCookies();
  const payload = buildSearchPayload(keyword, count, daysBack);
  console.log(`[search] keyword=${JSON.stringify(keyword)} count=${count} days=${daysBack}`);

  const res = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: { ...DEFAULT_HEADERS, Cookie: cookieHeader(cookies) },
    body: JSON.stringify(payload),
  });
  if ((res.status === 401 || res.status === 403) && retry) {
    console.log(`[search] ${res.status} → 세션 재발급 후 재시도`);
    await getSessionCookies(true);
    return callSearchApi(keyword, count, daysBack, false);
  }
  if (!res.ok) throw new Error(`search ${res.status}`);
  const data = await res.json();

  const candidates = [data.result, data.dlBidPbancLstD, data.dlBidPbancLst, data.data, data.list, data.rows];
  let rows = candidates.find(c => Array.isArray(c));
  if (!rows && data && typeof data === 'object') {
    for (const [k, v] of Object.entries(data)) {
      if (Array.isArray(v) && v.length) { rows = v; break; }
      if (v && typeof v === 'object') {
        for (const [, vv] of Object.entries(v)) {
          if (Array.isArray(vv) && vv.length) { rows = vv; break; }
        }
        if (rows) break;
      }
    }
  }
  rows = rows || [];
  console.log(`[search] ${rows.length} 행 수신`);
  return rows;
}

// ─────────────────────────────────────────────────────────────
// 첨부 파일 리스트 API
// ─────────────────────────────────────────────────────────────
export async function callAtchFileList(cookies, untyAtchFileNo) {
  if (!untyAtchFileNo) return [];
  const payload = {
    dlUntyAtchFileM: {
      untyAtchFileNo, atchFileSqnos: '',
      bsnePath: 'PNPE', bsneClsfCd: '업130026',
      tblNm: 'PBANC_BID_PBANC', colNm: 'ITEM_PBANC_UNTY_ATCH_FILE_NO',
      webPathUse: 'N', isScanEnabled: false, imgUrl: '',
      atchFileKndCds: '', ignoreAtchFileKndCds: '',
      kbrdrIds: '', kuploadId: 'g2b_crawler', viewMode: 'view',
    },
  };
  try {
    const res = await fetch(ATCH_FILE_LIST_URL, {
      method: 'POST',
      headers: { ...DETAIL_HEADERS, Cookie: cookieHeader(cookies) },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const list = data.dlUntyAtchFileL || [];
    return list.filter(r => r && typeof r === 'object').map(r => ({
      untyAtchFileNo: String(r.untyAtchFileNo || ''),
      atchFileSqno: String(r.atchFileSqno || ''),
      orgnlAtchFileNm: r.orgnlAtchFileNm || '',
      fileExtnNm: r.fileExtnNm || '',
      fileSz: Number(r.fileSz || 0),
      atchFileKndCd: r.atchFileKndCd || '',
      atchFileKndNm: r.atchFileKndNm || '',
      kbrdrNm: r.kbrdrNm || '',
      inptDt: r.inptDt || '',
    }));
  } catch (e) {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
// 상세 API (사업금액·진행정보·담당자·첨부)
// ─────────────────────────────────────────────────────────────
import { clean, money } from './utils.js';

export async function callDetailApi(cookies, bidNo, bidOrd) {
  if (!bidNo) return {};
  const payload = {
    dmItemMap: {
      bidPbancNo: bidNo,
      bidPbancOrd: bidOrd || '000',
      scsbdMthdCd: '',
      currentPage: 1,
      recordCountPerPage: '',
    },
  };
  let data;
  try {
    const res = await fetch(DETAIL_URL, {
      method: 'POST',
      headers: { ...DETAIL_HEADERS, Cookie: cookieHeader(cookies) },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return { _error: `HTTP ${res.status}` };
    data = await res.json();
  } catch (e) {
    return { _error: String(e) };
  }
  const item = data.dmItemMap || {};
  const progress = (data.dmItemList1 || []).filter(r => r && typeof r === 'object').map(r => ({
    ord: clean(r.ord),
    subject: clean(r.subject),
    prgNm: clean(r.prgNm),
    startDt: clean(r.startDt),
    endDt: clean(r.endDt),
    placNm: clean(r.placNm),
  }));
  const dmstPic = (data.dmItemList2 || []).filter(r => r && typeof r === 'object').map(r => ({
    dmstUntyGrpNm: clean(r.dmstUntyGrpNm),
    deptNm: clean(r.deptNm),
    picNm: clean(r.picNm),
    tlphNo: clean(r.tlphNo),
    faxNo: clean(r.faxNo),
    eml: clean(r.eml),
    evlPicYn: clean(r.evlPicYn),
  }));
  const atchNo = clean(item.itemPbancUntyAtchFileNo);
  const files = atchNo ? await callAtchFileList(cookies, atchNo) : [];

  return {
    bgtAmt: money(item.alotBgtAmt || item.bizAmt),
    prspPrce: money(item.prspPrce),
    vatAmt: money(item.vatAmt),
    scsbdMthd: clean(item.scsbdMthdNm),
    pnprMtho: clean(item.pnprDcsnMthoNm),
    pbancKnd: clean(item.pbancKndNm),
    progress, dmstPic, files,
    untyAtchFileNo: atchNo,
  };
}

// ─────────────────────────────────────────────────────────────
// 상세 enrich — 검색 결과 각 행에 in-place 합성 + 이전 채용대행 기록
// ─────────────────────────────────────────────────────────────
import { findPreviousAgencies } from './history.js';

export async function enrichWithDetails(items, concurrency = 8) {
  const cookies = await getSessionCookies();
  const currentYear = new Date().getFullYear().toString();
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const it = items[idx++];
      const bid = it._bidPbancNo || '';
      let bidNoClean = bid, ord = '000';
      const m = bid.match(/^(.+?)-(\d+)$/);
      if (m) { bidNoClean = m[1]; ord = m[2]; }
      const detail = await callDetailApi(cookies, bidNoClean, ord);
      for (const k of ['bgtAmt', 'prspPrce', 'scsbdMthd', 'pnprMtho']) {
        if (!it[k] && detail[k]) it[k] = detail[k];
      }
      it.progress = detail.progress || [];
      it.vatAmt = detail.vatAmt || '';
      it.pbancKnd = detail.pbancKnd || '';
      it.dmstPic = detail.dmstPic || [];
      it.files = detail.files || [];
      it.untyAtchFileNo = detail.untyAtchFileNo || '';

      // 이전 채용대행 기록 — 수요기관명으로 검색 (없으면 공고기관)
      const targetInst =
        (detail.dmstPic && detail.dmstPic[0] && detail.dmstPic[0].dmstUntyGrpNm) ||
        it.demander || it.agency || '';
      try {
        const r = await findPreviousAgencies(targetInst, currentYear);
        it.prevMatched = r.matched;
        it.prevHistory = r.history;
      } catch (e) {
        it.prevHistory = [];
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
}
