import 'dotenv/config';
import https from 'node:https';
import OpenAI from 'openai';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36';
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
function insecure(url) { return new Promise((res, rej) => { https.get(url, { headers: { 'User-Agent': UA }, rejectUnauthorized: false }, r => { const c = []; r.on('data', d => c.push(d)); r.on('end', () => res(Buffer.concat(c).toString('utf8'))); }).on('error', rej); }); }
async function get(url, cookie) {
  if (url.includes('kecthai.kr')) return insecure(url);
  let res = await fetch(url, { headers: { 'User-Agent': UA, ...(cookie ? { Cookie: cookie } : {}) }, redirect: 'manual', signal: AbortSignal.timeout(30000) });
  if (res.status >= 300 && res.status < 400) {
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    res = await fetch(url, { headers: { 'User-Agent': UA, Cookie: sc.map(c => c.split(';')[0]).join('; ') }, signal: AbortSignal.timeout(30000) });
  }
  return res.text();
}
function text(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}
const TARGETS = [
  ['at',      '[입찰공고] 2026년 2026년 태국 게임쇼 연계 K-푸드 문화 체험 홍보 사업 대행 용역', 'http://www.enjoykfood.com/index.php?mid=bidding&document_srl=' ],
  ['kec',     '2026년 태국한국교육원 한국어 말하기 대회 방한연수 운영 기관 공모', 'https://kecthai.kr/sub/news/1-1-detail.php?idx='],
  ['koipa',   '[수시_강원연계] 2026년 K-브랜드분쟁 대응전략 지원사업 수시 공고', 'https://www.koipa.re.kr/home/board/brdDetail.do?menu_cd=000041&num='],
  ['kcca',    '주태국한국문화원 행정직원(한국인) 채용 재공고', 'https://thailand.korean-culture.org/ko/1056/board/805/read/'],
  ['bizinfo', '[전북] SEOUL FOOD in Bangkok 2026 B2B 전시회 참가기업 모집 공고', 'https://www.bizinfo.go.kr/sii/siia/selectSIIA200Detail.do?pblancId='],
  ['suhyup',  '2026년도 보스턴·바르셀로나·방콕 국제수산박람회 운영대행 용역 입찰공고', 'https://www.suhyup.co.kr'],
];
import fs from 'node:fs';
const SC = 'C:/Users/alsxo/AppData/Local/Temp/claude/C--Users-alsxo-Documents-GitHub-narajangteo/1849a866-02c3-4c1e-86d5-82ebefb98459/scratchpad/';
const notices = JSON.parse(fs.readFileSync(SC + 'overseas_dump.json', 'utf8')).notices;
const today = new Date().toISOString().slice(0, 10);
const PROMPT = (title, body) => `오늘 날짜: ${today}
아래는 공공기관 공고 상세 페이지 텍스트입니다. 다음을 JSON 으로 추출하세요. 본문에 없으면 null.
{"deadline":"YYYY-MM-DD HH:mm 또는 YYYY-MM-DD (제출·접수 마감. 제안서/입찰서/신청 마감 중 가장 이른 실질 마감)","deadline_kind":"제안서|입찰서|신청|접수|기타","amount":"금액 원문 그대로 (통화·부가세 표기 포함)","amount_krw_est":숫자 또는 null,"topic":"15자 내외 주제","who":"발주/주관 기관","summary":"2문장 요약","contact":"담당자 연락처 있으면"}
제목: ${title}
본문: ${body.slice(0, 12000)}`;
const out = [];
for (const [src, title] of TARGETS) {
  const n = notices.find(x => x.source === src && x.title === title);
  if (!n) { console.log('NOT FOUND', src, title); continue; }
  try {
    const html = await get(n.url);
    const body = text(html);
    const resp = await client.chat.completions.create({ model, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: PROMPT(n.title, body) }] });
    const j = JSON.parse(resp.choices[0].message.content);
    const dday = j.deadline ? Math.ceil((new Date(j.deadline.slice(0, 10)) - new Date(today)) / 86400000) : null;
    out.push({ src, title: n.title, url: n.url, bodyLen: body.length, ...j, dday });
    console.log(`\n## ${src} | ${n.title.slice(0, 50)} | body ${body.length}자`);
    console.log(`   마감: ${j.deadline} (${j.deadline_kind}) D${dday == null ? '?' : dday >= 0 ? '-' + dday : '+' + (-dday)} | 금액: ${j.amount} | 주제: ${j.topic}`);
    console.log(`   ${j.summary}`);
  } catch (e) { console.log('ERR', src, e.message); out.push({ src, title, error: e.message }); }
}
fs.writeFileSync(SC + 'detail_th_test.json', JSON.stringify(out, null, 1));
