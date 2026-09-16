const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36';
async function count(label, url, re, opts = {}) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...(opts.headers || {}) }, method: opts.method || 'GET', body: opts.body, signal: AbortSignal.timeout(30000) });
    const html = await res.text();
    const n = (html.match(re) || []).length;
    console.log(`${label.padEnd(28)} HTTP ${res.status}  rows=${n}  blocked=${/Web firewall|비정상적인 접근|Access Denied/.test(html)}`);
  } catch (e) { console.log(`${label.padEnd(28)} ERR ${e.message}`); }
}
await count('at 무키워드 1p', 'http://www.enjoykfood.com/?mid=bidding', /document_srl=\d+"[^>]*>/g);
await count('suhyup 무키워드 1p', 'https://www.suhyup.co.kr/bbs/suhyup/23/artclList.do', /artclRows_23_\d+/g);
await count('koipa 사업공고 무키워드', 'https://www.koipa.re.kr/home/board/brdList.do?menu_cd=000041', /pageviewform\('\d+'\)/g);
await count('koipa 입찰공고 무키워드', 'https://www.koipa.re.kr/home/board/brdList.do?menu_cd=000042', /pageviewform\('\d+'\)/g);
await count('kotra 무키워드 50', 'https://www.kotra.or.kr/bangkok/module/subhome/bizAply/selectBmBizKbcListAjax.do', /dtlBizMntNo=/g,
  { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest', Referer: 'https://www.kotra.or.kr/bangkok/subList/40000000403' },
    body: new URLSearchParams({ pageNo: '1', listCount: '50', query: '', collection: 'business_application', sch_biz_name: '', appl_biz_dept_cd: '9101', startCount: '0' }) });
await count('bizinfo 무키워드 1p(30)', 'https://www.bizinfo.go.kr/sii/siia/selectSIIA200View.do?schEndAt=N&rows=30&cpage=1', /pblancId=PBLN_\d+/g);
await count('bizinfo 동남아', 'https://www.bizinfo.go.kr/sii/siia/selectSIIA200View.do?condition=searchPblancNm&keyword=%EB%8F%99%EB%82%A8%EC%95%84&schEndAt=N&rows=30&cpage=1', /pblancId=PBLN_\d+/g);
await count('bizinfo 아세안', 'https://www.bizinfo.go.kr/sii/siia/selectSIIA200View.do?condition=searchPblancNm&keyword=%EC%95%84%EC%84%B8%EC%95%88&schEndAt=N&rows=30&cpage=1', /pblancId=PBLN_\d+/g);
// koipa 상세 — Referer 붙여서
const r = await fetch('https://www.koipa.re.kr/home/board/brdDetail.do?menu_cd=000041&num=1000000000000000000', { headers: { 'User-Agent': UA } }).catch(() => null);
