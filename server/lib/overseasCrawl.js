// 해외 공고 크롤러 — 소스(기관)별 목록 페이지 fetch + 파싱
// 소스 정의는 DB overseas_sources (source_key 로 파서 선택).
// 각 파서는 [{ noticeKey, title, url, postedAt }] 를 반환한다.

import https from 'node:https';
import { createHash } from 'node:crypto';

// 사이트가 안정적인 id 를 주지 않을 때 쓰는 내용 기반 키
function contentKey(...parts) {
  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
export const KEYWORDS = ['태국', '방콕', 'bangkok', 'thailand'];

async function fetchText(url, { cookie = null, timeoutMs = 30000 } = {}) {
  const headers = { 'User-Agent': UA, 'Accept-Language': 'ko,en;q=0.8' };
  if (cookie) headers['Cookie'] = cookie;
  const res = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
  return res;
}

// kecthai.kr 은 중간 인증서 누락으로 Node fetch 가 TLS 검증 실패 →
// 이 호스트에 한해 node:https 로 검증 완화해서 GET (공개 게시판 읽기 전용)
function httpsGetInsecure(url, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'ko,en;q=0.8' },
      rejectUnauthorized: false,
      timeout: timeoutMs,
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function stripTags(s) {
  return (s || '')
    .replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
    // KOTRA 는 검색어 하이라이트를 &lt;!HS&gt; 로 이스케이프해 보내므로 엔티티 복원 후에 제거
    .replace(/<!\/?H[SE]>/g, '')
    .replace(/\s+/g, ' ').trim();
}

// "2025.12.09" / "2025-12-09" / "Jun.24.2026" → "YYYY-MM-DD"
const MONTHS = { jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06',
                 jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12' };
function normDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  let m = s.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/([A-Za-z]{3})[.\s]+(\d{1,2})[,.\s]+(\d{4})/);
  if (m && MONTHS[m[1].toLowerCase()]) {
    return `${m[3]}-${MONTHS[m[1].toLowerCase()]}-${m[2].padStart(2, '0')}`;
  }
  return null;
}

// 여러 키워드 검색 결과를 noticeKey 기준으로 중복 제거해 합침
async function collectByKeyword(fn) {
  const out = [];
  const seen = new Set();
  for (const kw of KEYWORDS) {
    const items = await fn(kw);
    for (const it of items) {
      if (seen.has(it.noticeKey)) continue;
      seen.add(it.noticeKey);
      out.push(it);
    }
  }
  return out;
}

// ── 주태국 한국문화원 (KCCA) — 첫 요청이 302 + Set-Cookie 라 쿠키 받고 재요청 ──
async function crawlKcca() {
  const listUrl = 'https://thailand.korean-culture.org/ko/1056/board/805/list';
  let res = await fetchText(listUrl);
  let cookie = null;
  if (res.status >= 300 && res.status < 400) {
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
    cookie = setCookies.map(c => c.split(';')[0]).join('; ');
    res = await fetchText(listUrl, { cookie });
  }
  if (!res.ok) throw new Error(`KCCA list HTTP ${res.status}`);
  const html = await res.text();

  const items = [];
  const rows = html.split(/<tr class="bbsList">/).slice(1);
  for (const row of rows) {
    const seq = row.match(/seq="(\d+)"/)?.[1];
    if (!seq) continue;
    const titleRaw = row.match(/seq="\d+"\s*>([\s\S]*?)<\/a>/)?.[1];
    const date = row.match(/(\d{4})\.(\d{2})\.(\d{2})\./);
    items.push({
      noticeKey: seq,
      title: stripTags(titleRaw),
      url: `https://thailand.korean-culture.org/ko/1056/board/805/read/${seq}`,
      postedAt: date ? `${date[1]}-${date[2]}-${date[3]}` : null,
    });
  }
  return items;
}

// ── 태국한국교육원 (KEC) — 공지사항 게시판 ──
async function crawlKec() {
  const html = await httpsGetInsecure('https://kecthai.kr/sub/news/1-1.php');

  const items = [];
  const re = /<tr onclick="location\.href='(\/sub\/news\/1-1-detail\.php\?idx=(\d+))';">([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const [, path, idx, body] = m;
    const title = stripTags(body.match(/<td class="title">([\s\S]*?)<\/td>/)?.[1]);
    const date = body.match(/<td class="date">\s*([\d-]+)\s*<\/td>/)?.[1] || null;
    if (!title) continue;
    items.push({
      noticeKey: idx,
      title,
      url: `https://kecthai.kr${path}`,
      postedAt: date,
    });
  }
  return items;
}

// ── 한국지식재산보호원 (KOIPA) — 게시판 2개 × 키워드 검색 ──
async function crawlKoipa() {
  const items = [];
  const seen = new Set();
  for (const menuCd of ['000041', '000042']) {
    const got = await collectByKeyword(async (kw) => {
      const url = `https://www.koipa.re.kr/home/board/brdList.do?menu_cd=${menuCd}&searchText=${encodeURIComponent(kw)}&searchData=contdata`;
      const res = await fetchText(url);
      if (!res.ok) throw new Error(`KOIPA(${menuCd}, ${kw}) HTTP ${res.status}`);
      const html = await res.text();
      const out = [];
      const re = /pageviewform\('(\d+)'\);">([\s\S]*?)<\/a>([\s\S]*?)<\/tr>/g;
      let m;
      while ((m = re.exec(html)) !== null) {
        const [, num, anchorBody, rest] = m;
        const title = stripTags(anchorBody);
        if (!title) continue;
        out.push({
          noticeKey: `${menuCd}-${num}`,
          title,
          url: `https://www.koipa.re.kr/home/board/brdDetail.do?menu_cd=${menuCd}&num=${num}`,
          postedAt: normDate(rest.match(/col-date[^>]*>[\s\S]*?<span>([\d-]+)<\/span>/)?.[1]),
        });
      }
      return out;
    });
    for (const it of got) {
      if (seen.has(it.noticeKey)) continue;
      seen.add(it.noticeKey);
      items.push(it);
    }
  }
  return items;
}

// ── 기업마당 (bizinfo) — 지원사업명 키워드 검색 ──
async function crawlBizinfo() {
  return collectByKeyword(async (kw) => {
    const url = `https://www.bizinfo.go.kr/sii/siia/selectSIIA200View.do?condition=searchPblancNm&condition1=AND&keyword=${encodeURIComponent(kw)}&schEndAt=N&rows=30&cpage=1`;
    const res = await fetchText(url);
    if (!res.ok) throw new Error(`bizinfo(${kw}) HTTP ${res.status}`);
    const html = await res.text();
    const out = [];
    const re = /<a href=\s*"[^"]*selectSIIA200Detail\.do\?[^"]*pblancId=(PBLN_\d+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)<\/tr>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const [, pblancId, anchorBody, rest] = m;
      const title = stripTags(anchorBody);
      if (!title) continue;
      // 등록일 = 단독 날짜 형태의 마지막 <td> (신청기간은 "A ~ B" 라 제외됨)
      const dates = [...rest.matchAll(/<td>\s*(\d{4}-\d{2}-\d{2})\s*<\/td>/g)].map(x => x[1]);
      out.push({
        noticeKey: pblancId,
        title,
        url: `https://www.bizinfo.go.kr/sii/siia/selectSIIA200Detail.do?pblancId=${pblancId}`,
        postedAt: dates.length ? dates[dates.length - 1] : null,
      });
    }
    return out;
  });
}

// ── 한국관광공사 (KTO / 투어라즈) — 입찰공고 2탭 + 공고·공모 ──
async function crawlKto() {
  const items = [];
  const seen = new Set();

  // 입찰공고: KTO 자체(ktoip) + 유관기관(other)
  for (const tabMode of ['ktoip', 'other']) {
    const got = await collectByKeyword(async (kw) => {
      const url = `https://touraz.kr/publicTenderList?tabMode=${tabMode}&searchCd=all&searchText=${encodeURIComponent(kw)}&curPage=1&cntPerPage=30`;
      const res = await fetchText(url);
      if (!res.ok) throw new Error(`KTO tender(${tabMode}, ${kw}) HTTP ${res.status}`);
      const html = await res.text();
      const out = [];
      const re = /<a href="(\/publicTenderList\/publicTenderView\?tabMode=[^"]*bbsSeq=(\d+))">\s*<span class="text txt-subject">([\s\S]*?)<\/span>[\s\S]*?<\/a>([\s\S]*?)<\/li>/g;
      let m;
      while ((m = re.exec(html)) !== null) {
        const [, path, bbsSeq, titleRaw, rest] = m;
        const title = stripTags(titleRaw);
        if (!title) continue;
        // col-date 가 2개(마감일/등록일) — 마지막 것이 등록일
        const dates = [...rest.matchAll(/col-date"><strong>([^<]*)<\/strong>/g)]
          .map(x => normDate(x[1])).filter(Boolean);
        out.push({
          noticeKey: `tender-${tabMode}-${bbsSeq}`,
          title,
          url: `https://touraz.kr${path.replace(/&amp;/g, '&')}`,
          postedAt: dates.length ? dates[dates.length - 1] : null,
        });
      }
      return out;
    });
    for (const it of got) {
      if (seen.has(it.noticeKey)) continue;
      seen.add(it.noticeKey);
      items.push(it);
    }
  }

  // 공고·공모 (announcementList)
  const anns = await collectByKeyword(async (kw) => {
    const url = `https://touraz.kr/announcementList?searchCd=all&searchText=${encodeURIComponent(kw)}&curPage=1&cntPerPage=30`;
    const res = await fetchText(url);
    if (!res.ok) throw new Error(`KTO announcement(${kw}) HTTP ${res.status}`);
    const html = await res.text();
    const out = [];
    const re = /<div class="subject"><a href="(\/announcementList\/pssrpView\?pssrpSeqEnc=[^"]*)">([\s\S]*?)<\/a><\/div>([\s\S]*?)<\/dl>\s*<\/div>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const [, path, titleRaw, rest] = m;
      const title = stripTags(titleRaw);
      if (!title) continue;
      const posted = normDate(rest.match(/등록일\s*<\/dt>[\s\S]*?<dd>\s*([\d.\-]+)/)?.[1]);
      out.push({
        // pssrpSeqEnc 는 목록을 그릴 때마다 새로 암호화돼 매 크롤마다 값이 달라진다.
        // (링크 자체는 계속 유효) → 중복 저장 방지를 위해 제목+등록일 기반 키를 쓴다.
        noticeKey: `ann-${contentKey(title, posted || '')}`,
        title,
        url: `https://touraz.kr${path.replace(/&amp;/g, '&')}`,
        postedAt: posted,
      });
    }
    return out;
  });
  for (const it of anns) {
    if (seen.has(it.noticeKey)) continue;
    seen.add(it.noticeKey);
    items.push(it);
  }

  return items;
}

// ── 수협중앙회 방콕무역지원센터 — 입찰공고 게시판 제목 검색 ──
async function crawlSuhyup() {
  return collectByKeyword(async (kw) => {
    const url = `https://www.suhyup.co.kr/bbs/suhyup/23/artclList.do?srchColumn=sj&srchWrd=${encodeURIComponent(kw)}`;
    const res = await fetchText(url);
    if (!res.ok) throw new Error(`수협(${kw}) HTTP ${res.status}`);
    const html = await res.text();
    const out = [];
    const re = /<tr id="artclRows_23_(\d+)"[\s\S]*?<a href="(\/bbs\/suhyup\/23\/\d+\/artclView\.do)"[\s\S]*?<strong>([\s\S]*?)<\/strong>([\s\S]*?)<\/tr>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const [, artclSeq, path, titleRaw, rest] = m;
      const title = stripTags(titleRaw);
      if (!title) continue;
      out.push({
        noticeKey: artclSeq,
        title,
        url: `https://www.suhyup.co.kr${path}`,
        postedAt: normDate(rest.match(/td-date[^>]*>\s*([\d.\-]+)\s*</)?.[1]),
      });
    }
    return out;
  });
}

// ── 한국농수산식품유통공사 (aT) 방콕지사 — enjoykfood 입찰공고 (제목+내용 검색) ──
// https 는 자가서명 인증서라 실패 → http 로 접근 (공개 게시판 읽기 전용)
async function crawlAt() {
  return collectByKeyword(async (kw) => {
    const url = `http://www.enjoykfood.com/?mid=bidding&search_target=title_content&search_keyword=${encodeURIComponent(kw)}`;
    const res = await fetchText(url);
    if (!res.ok) throw new Error(`aT(${kw}) HTTP ${res.status}`);
    const html = await res.text();
    const out = [];
    const re = /<td class="title">\s*<a href="([^"]*document_srl=(\d+))"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)<\/tr>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const [, href, srl, titleRaw, rest] = m;
      const title = stripTags(titleRaw);
      if (!title) continue;
      out.push({
        noticeKey: srl,
        title,
        url: `http://www.enjoykfood.com/index.php?mid=bidding&document_srl=${srl}`,
        postedAt: normDate(rest.match(/<td class="time">([^<]*)<\/td>/)?.[1]),
      });
    }
    return out;
  });
}

// ── KOTRA 방콕무역관 — 사업 안내 (ajax 목록) ──
async function crawlKotra() {
  return collectByKeyword(async (kw) => {
    const res = await fetch('https://www.kotra.or.kr/bangkok/module/subhome/bizAply/selectBmBizKbcListAjax.do', {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': 'https://www.kotra.or.kr/bangkok/subList/40000000403',
      },
      body: new URLSearchParams({
        pageNo: '1', listCount: '50', query: kw,
        collection: 'business_application', sch_biz_name: '',
        appl_biz_dept_cd: '9101', startCount: '0',
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`KOTRA(${kw}) HTTP ${res.status}`);
    const html = await res.text();
    const out = [];
    const re = /<a href="javascript:fn_selectBizMntInfoDetail\('([^']*dtlBizMntNo=([^&']+)[^']*)'\);">([\s\S]*?)<\/a>([\s\S]*?)<\/ul>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const [, path, bizNo, titleRaw, rest] = m;
      const title = stripTags(titleRaw);
      if (!title) continue;
      // 게시일 개념이 없어 신청기간 시작일을 사용
      const posted = normDate(rest.match(/신청기간\s*:\s*([\d\-.]+)/)?.[1]);
      out.push({
        noticeKey: bizNo,
        title,
        url: `https://www.kotra.or.kr${path.replace(/&amp;/g, '&')}`,
        postedAt: posted,
      });
    }
    return out;
  });
}

const CRAWLERS = {
  kcca: crawlKcca,
  kec: crawlKec,
  koipa: crawlKoipa,
  bizinfo: crawlBizinfo,
  kto: crawlKto,
  suhyup: crawlSuhyup,
  at: crawlAt,
  kotra: crawlKotra,
};

export async function crawlSource(sourceKey) {
  const fn = CRAWLERS[sourceKey];
  if (!fn) throw new Error(`알 수 없는 source_key: ${sourceKey}`);
  return fn();
}

export const KNOWN_SOURCE_KEYS = Object.keys(CRAWLERS);
