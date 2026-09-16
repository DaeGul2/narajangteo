// 해외(태국) 공고 판별 — v4 (2026-09-16)
// 채용대행 크롤러의 aiClassify.js 와는 완전 별개 (프롬프트·캐시·기준 전부 다름).
//
// 2단계:
//   1) 규칙 A — 제목에 태국·태국 도시·태국 개최 전시명이 있으면 GPT 없이 확정.
//      GPT 장애·키 미설정이어도 태국 명시 건은 반드시 통과시키기 위함 (놓침 방지 최우선).
//   2) GPT   — 나머지 제목을 보고 B(동남아·아세안 등 권역, 태국 포함 가능성) / X(제외) 판정.
//      + 유형(용역/모집/채용/안내) + 주제(10자 내외) 도 같이 뽑는다. A 건도 유형·주제는 GPT 로 채움.
//
// 1년치 g2b 테스트(609건): A 41 (재현율 100%) / B 106 / X 462.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.resolve(__dirname, '../../_ncs_data/overseas_classify_cache.json');

// 규칙 A — 태국 명시 (검색 키워드보다 넓게: 컨벤션센터·전시명 포함)
export const THAI_RULE_RE = /태국|방콕|치앙마이|치앙라이|푸켓|파타야|끄라비|후아힌|코사무이|아유타야|thailand|bangkok|chiang\s?mai|chiang\s?rai|phuket|pattaya|krabi|hua\s?hin|thaifex|bitec|qsncc|impact\s?(arena|exhibition|muang)|퀸시리킷|무앙통타니|가스텍|gastech|metalex|메탈렉스/i;

let _cache = null;
function loadCache() {
  if (_cache) return _cache;
  try { _cache = fs.existsSync(CACHE_PATH) ? JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8')) : {}; }
  catch { _cache = {}; }
  return _cache;
}
function saveCache() {
  try { fs.writeFileSync(CACHE_PATH, JSON.stringify(_cache, null, 2), 'utf-8'); }
  catch (e) { console.error('[overseasClassify] cache save failed:', e.message); }
}

const SYSTEM = `당신은 한국 공공기관 공고 제목을 보고 "태국(Thailand)과 관련된 공고인지" 판정합니다.
사업 장소·대상 국가·참가자·바이어·계약 상대 중 하나라도 태국이면 관련. 한국에서 하든 태국에서 하든 무관.
⚠ 판정 근거는 **제목** 입니다. 함께 주는 기관명(org)은 힌트일 뿐이며, 기관명에 "방콕지사·태국사무소·동남아 IP센터" 같은 말이 있어도
제목에 태국·권역 근거가 없으면 X 입니다 (본사 공용 게시판에 올라온 국내 사업이 대부분이기 때문).

[등급]
- "A": 제목에 태국 또는 태국 도시·태국 개최 행사명이 명시됨
- "B": 태국이 직접 명시되진 않았지만 태국이 포함될 가능성이 높은 권역 사업 — 동남아, 동남아시아, 아세안, ASEAN, 메콩, 인도차이나, 아세안+3 등.
       단 국가 목록이 명시되어 있고 태국이 빠져 있으면 "X".
- "X": 그 외 전부. 특히 다음은 반드시 X:
  · 국가·권역이 전혀 명시되지 않은 일반 해외사업 (해외전시, 수출상담회, 무역사절단, 바이어 초청, 해외마케팅 — 어디인지 모르면 X)
  · 태국·동남아 외 지역만 명시 (인도, 일본, 중국, 미국, 유럽, 중동, 아프리카, 중앙아시아, 오세아니아 등)
  · 단어 우연 일치 (동남아파트, 동남아트센터, 임팩트 소켓, 바이텍 시약, With AI 등), 국내 전용 사업

[type]
- "용역": 입찰·제안·대행·위탁·공사·구매 등 업체가 응찰하는 것 (운영대행, 부스 장치, 상담회 운영, 연수 프로그램, 조사 용역 등)
- "모집": 참가기업·참여기업·수행기관·파트너·운영사 모집
- "채용": 직원 채용
- "안내": 행사 안내·결과 발표·설문·명단 공지 등 영업 기회 아님

[출력 — JSON]
{"results":[{"id":"<id>","grade":"A|B|X","type":"용역|모집|채용|안내","topic":"<10자 내외 주제>","reason":"<한 줄 근거>"}]}
모든 입력에 빠짐없이 응답.`;

/**
 * @param {Array<{id:string, title:string, org?:string}>} items
 * @returns {Promise<Map<string, {grade:'A'|'B'|'X', type:string, topic:string, reason:string, by:'rule'|'gpt'|'rule+gpt'|'cache'}>>}
 */
export async function classifyOverseas(items, { force = false } = {}) {
  loadCache();
  const out = new Map();
  const ruleA = new Set();
  const ruleReason = new Map();
  const todo = [];

  for (const it of items) {
    const title = it.title || '';
    // 규칙 A: ① 제목에 태국 명시  ② 태국 소재 기관(문화원·교육원·KOTRA 방콕무역관 담당사업)의 자체 게시판 → 주체가 태국
    const isA = THAI_RULE_RE.test(title) || !!it.branchThai;
    if (isA) {
      ruleA.add(it.id);
      ruleReason.set(it.id, it.branchThai && !THAI_RULE_RE.test(title) ? '태국 소재 기관(지사) 자체 게시판 — 주체가 태국' : '제목에 태국 명시 (규칙)');
    }
    const cached = force ? null : _cache[title];
    if (cached) {
      // 캐시된 GPT 결과에 규칙 A 를 덮어쓴다 (규칙이 항상 우선)
      out.set(it.id, { ...cached, grade: isA ? 'A' : cached.grade, reason: isA ? `${ruleReason.get(it.id)} · ${cached.reason}` : cached.reason, by: 'cache' });
    } else {
      todo.push(it);
    }
  }

  const key = process.env.OPENAI_API_KEY;
  if (todo.length && key) {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: key });
    const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
    const BATCH = 60;
    for (let i = 0; i < todo.length; i += BATCH) {
      const batch = todo.slice(i, i + BATCH);
      try {
        const resp = await client.chat.completions.create({
          model, temperature: 0.1,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: JSON.stringify(batch.map(b => ({ id: b.id, org: b.org || '', title: b.title }))) },
          ],
        });
        const results = JSON.parse(resp.choices?.[0]?.message?.content || '{}').results || [];
        for (const r of results) {
          const item = batch.find(b => b.id === r.id);
          if (!item) continue;
          const gptGrade = ['A', 'B', 'X'].includes(r.grade) ? r.grade : 'X';
          const v = {
            grade: gptGrade,
            type: ['용역', '모집', '채용', '안내'].includes(r.type) ? r.type : '안내',
            topic: String(r.topic || '').slice(0, 100),
            reason: String(r.reason || '').slice(0, 500),
          };
          _cache[item.title] = v;
          const a = ruleA.has(item.id);
          out.set(item.id, { ...v, grade: a ? 'A' : v.grade, reason: a ? `${ruleReason.get(item.id)} · ${v.reason}` : v.reason, by: a ? 'rule+gpt' : 'gpt' });
        }
      } catch (e) {
        console.error('[overseasClassify] GPT batch failed:', e.message);
      }
    }
    saveCache();
  }

  // GPT 를 못 탄 것(키 없음·장애·응답 누락): 규칙 A 면 A, 아니면 미판정(null) — 호출측이 처리
  for (const it of items) {
    if (out.has(it.id)) continue;
    if (ruleA.has(it.id)) {
      out.set(it.id, { grade: 'A', type: '', topic: '', reason: ruleReason.get(it.id), by: 'rule' });
    } else {
      out.set(it.id, { grade: null, type: '', topic: '', reason: 'GPT 미판정', by: 'none' });
    }
  }
  return out;
}
