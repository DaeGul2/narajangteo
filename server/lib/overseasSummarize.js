// 해외(태국) 공고 요약 — v4 (2026-09-16)
// 상세 페이지 본문 텍스트 → GPT → { deadline, deadlineKind, amount, topic, summary }
// g2b 는 검색 행에 마감·금액이 이미 있어 이 모듈을 거치지 않는다 (cron_overseas.js 에서 분기).
// 금액은 첨부(HWP/PDF)에만 있는 경우가 많아 null 이 흔하다 — 첨부 텍스트 추출은 2단계.

import https from 'node:https';
import { GRADE_BX_RULES } from './overseasClassify.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function httpsGetInsecure(url, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA }, rejectUnauthorized: false, timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function fetchDetailHtml(url) {
  // kecthai.kr — 중간 인증서 누락 (overseasCrawl.js 와 동일 우회)
  if (/kecthai\.kr/i.test(url)) return httpsGetInsecure(url);
  let res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ko,en;q=0.8' }, redirect: 'manual', signal: AbortSignal.timeout(30000) });
  if (res.status >= 300 && res.status < 400) {
    // KCCA — 302 + Set-Cookie 후 재요청
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
    const cookie = sc.map(c => c.split(';')[0]).join('; ');
    res = await fetch(url, { headers: { 'User-Agent': UA, Cookie: cookie }, signal: AbortSignal.timeout(30000) });
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export function htmlToText(html) {
  return String(html || '')
    .replace(/<head\b[\s\S]*?<\/head>/gi, ' ')
    .replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

function todayKst() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }); // YYYY-MM-DD
}

const EXTRACT_FIELDS = `  "deadline": "YYYY-MM-DD HH:mm 또는 YYYY-MM-DD — 제출·접수 마감. 제안서/입찰서/신청/접수 마감 중 실질적인 최종 마감 1개",
  "deadline_kind": "제안서|입찰서|신청|접수|기타",
  "amount": "금액 원문 그대로 (통화·부가세 표기 포함, 예: '694,000 THB (부가세 포함)', '1억 2,500만원')",
  "topic": "15자 내외 주제 (무엇을 하는 사업인지)",
  "summary": "2문장 요약 — 무엇을, 누가, 언제까지",
  "contact": "담당자·연락처 있으면 한 줄"`;

function buildPrompt(title, org, body) {
  return `오늘 날짜(KST): ${todayKst()}
아래는 한국 공공기관(또는 해외 지사) 공고 상세 페이지 텍스트입니다. 다음을 JSON 으로 추출하세요. 본문에 없으면 null. 추측 금지.
{
${EXTRACT_FIELDS}
}
기관: ${org || ''}
제목: ${title}
본문: ${body.slice(0, 12000)}`;
}

// v4.3 — 제목만으로 X 가 나온 공고를 본문까지 읽혀 재판별 + 요약 (GPT 1회)
function buildJudgePrompt(title, org, body) {
  return `오늘 날짜(KST): ${todayKst()}
아래는 한국 공공기관(또는 해외 지사) 공고 상세 페이지 텍스트입니다.
1) 이 공고가 "태국(Thailand) 법인이 영업 기회로 볼 만한 공고인지" **본문 내용까지 보고** 등급을 매기세요.
   사업 장소·대상 국가·참가자·바이어·계약 상대 중 하나라도 태국이거나 태국일 수 있으면 관련. 한국에서 하든 해외에서 하든 무관.
   ⚠ 놓치는 것이 잘못 보내는 것보다 훨씬 나쁩니다. 애매하면 B.
   ⚠ 근거는 **이 공고 자체의 본문**이어야 합니다. 페이지에 함께 찍힌 메뉴·다른 게시글 제목 목록·이전글/다음글·배너·기관 소개(예: "방콕지사" 라는 부서명 자체)는 근거가 아닙니다.
   - "A": 이 공고의 사업 장소·대상·참가자 등이 태국(태국 도시·태국 개최 행사 포함)으로 명시됨
${GRADE_BX_RULES}
2) 아래 항목을 JSON 으로 출력하세요. 본문에 없으면 null. 추측 금지.
{
  "grade": "A|B|X",
  "reason": "한 줄 근거 (본문의 어떤 문구 때문인지)",
${EXTRACT_FIELDS}
}
기관: ${org || ''}
제목: ${title}
본문: ${body.slice(0, 12000)}`;
}

const EMPTY = { deadline: null, deadlineKind: null, amount: null, topic: null, summary: null, contact: null, bodyLen: 0 };

async function fetchBody(url) {
  if (!url) return { error: 'url 없음' };
  let body = '';
  try {
    body = htmlToText(await fetchDetailHtml(url));
  } catch (e) {
    return { error: `상세 페이지 fetch 실패: ${e.message}` };
  }
  if (body.length < 120) return { bodyLen: body.length, error: '본문 텍스트 부족 (첨부 전용 공고 추정)' };
  return { body, bodyLen: body.length };
}

async function askGpt(prompt) {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const resp = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4.1-mini', temperature: 0,
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: prompt }],
  });
  return JSON.parse(resp.choices?.[0]?.message?.content || '{}');
}

function parseExtract(j) {
  // GPT 가 "2026-09-27 — 접수" 처럼 덧붙이는 경우가 있어 날짜(+시각)만 추출
  const dm = typeof j.deadline === 'string' ? j.deadline.match(/(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/) : null;
  return {
    deadline: dm ? `${dm[1]}${dm[2] ? ' ' + dm[2] : ''}` : null,
    deadlineKind: j.deadline_kind || null,
    amount: j.amount && !/^\s*0\s*(원|THB|USD)?\s*$/i.test(String(j.amount)) ? String(j.amount).slice(0, 100) : null,
    topic: j.topic ? String(j.topic).slice(0, 100) : null,
    summary: j.summary ? String(j.summary) : null,
    contact: j.contact ? String(j.contact) : null,
  };
}

/**
 * @returns {Promise<{deadline:string|null, deadlineKind:string|null, amount:string|null, topic:string|null, summary:string|null, contact:string|null, bodyLen:number, error?:string}>}
 */
export async function summarizeOverseasNotice({ title, url, organization }) {
  const b = await fetchBody(url);
  if (b.error) return { ...EMPTY, bodyLen: b.bodyLen || 0, error: b.error };
  if (!process.env.OPENAI_API_KEY) return { ...EMPTY, bodyLen: b.bodyLen, error: 'OPENAI_API_KEY 미설정' };
  try {
    return { ...parseExtract(await askGpt(buildPrompt(title, organization, b.body))), bodyLen: b.bodyLen };
  } catch (e) {
    return { ...EMPTY, bodyLen: b.bodyLen, error: `GPT 실패: ${e.message}` };
  }
}

/**
 * 본문 판별 + 요약. 본문을 못 읽으면 grade=null + error (호출측은 제목 판별 결과 유지).
 * @returns {Promise<{grade:'A'|'B'|'X'|null, reason:string|null, deadline, deadlineKind, amount, topic, summary, contact, bodyLen:number, error?:string}>}
 */
export async function judgeAndSummarize({ title, url, organization }) {
  const b = await fetchBody(url);
  if (b.error) return { ...EMPTY, grade: null, reason: null, bodyLen: b.bodyLen || 0, error: b.error };
  if (!process.env.OPENAI_API_KEY) return { ...EMPTY, grade: null, reason: null, bodyLen: b.bodyLen, error: 'OPENAI_API_KEY 미설정' };
  try {
    const j = await askGpt(buildJudgePrompt(title, organization, b.body));
    return {
      grade: ['A', 'B', 'X'].includes(j.grade) ? j.grade : null,
      reason: j.reason ? String(j.reason).slice(0, 500) : null,
      ...parseExtract(j), bodyLen: b.bodyLen,
    };
  } catch (e) {
    return { ...EMPTY, grade: null, reason: null, bodyLen: b.bodyLen, error: `GPT 실패: ${e.message}` };
  }
}

// "YYYY-MM-DD[ HH:mm]" → 오늘(KST) 기준 D-day 정수. null 이면 null. 마감 지났으면 음수.
export function ddayOf(deadline) {
  if (!deadline) return null;
  const m = String(deadline).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const [y, mo, d] = todayKst().split('-').map(Number);
  const now = Date.UTC(y, mo - 1, d);
  return Math.round((t - now) / 86400000);
}
