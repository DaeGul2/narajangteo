import 'dotenv/config';
import fs from 'node:fs';
import OpenAI from 'openai';
const SC = 'C:/Users/alsxo/AppData/Local/Temp/claude/C--Users-alsxo-Documents-GitHub-narajangteo/1849a866-02c3-4c1e-86d5-82ebefb98459/scratchpad/';
const g2b = JSON.parse(fs.readFileSync(SC + 'g2b_th_test.json', 'utf8')).items;
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

// 1단계: 규칙 — 태국 명시어가 있으면 GPT 없이 A 확정
const THAI_RE = /태국|방콕|치앙마이|치앙라이|푸켓|푸켓|파타야|끄라비|후아힌|코사무이|아유타야|thailand|bangkok|chiang\s?mai|phuket|pattaya|thaifex|bitec|qsncc|impact\s?(arena|exhibition|muang)|퀸시리킷|무앙통타니/i;

const SYSTEM = `당신은 한국 공공기관 공고 제목을 보고 "태국(Thailand)과 관련된 공고인지" 판정합니다.

[등급]
- "A": 제목에 태국 또는 태국 도시·태국 개최 행사명이 명시됨 (이미 규칙으로 걸러졌으므로 거의 없음)
- "B": 태국이 직접 명시되진 않았지만 태국이 포함될 가능성이 높은 권역 사업 — 동남아, 동남아시아, 아세안, ASEAN, 메콩, 인도차이나, "아시아 신흥시장" 등. 단 국가 목록이 명시되어 있고 태국이 빠져 있으면 "X".
- "X": 그 외 전부. 특히 다음은 반드시 X:
  · 국가·권역이 전혀 명시되지 않은 일반 해외사업 (해외전시, 수출상담회, 무역사절단, 바이어 초청, 해외마케팅 등 — 어디인지 모르면 X)
  · 태국·동남아 외 지역만 명시 (인도, 일본, 중국, 미국, 유럽, 중동, 아프리카, 중앙아시아, 오세아니아 등)
  · 단어 우연 일치 (임팩트 소켓, 바이텍 시약, With AI 등), 국내 전용 사업

[type] 용역(입찰·제안·대행·위탁·공사·구매) / 모집(참가·참여기업·수행기관) / 채용 / 안내(결과·설문·행사안내)

[출력 JSON] {"results":[{"id":"<id>","grade":"A|B|X","type":"용역|모집|채용|안내","topic":"<10자 내외>","reason":"<한 줄>"}]}  모든 입력에 응답.`;

const ruleA = [], todo = [];
g2b.forEach((it, i) => (THAI_RE.test(it.name) ? ruleA : todo).push({ id: 'g' + i, org: it.agency, title: it.name, it }));
const res = new Map();
for (const r of ruleA) res.set(r.id, { grade: 'A', src: 'rule' });
for (let i = 0; i < todo.length; i += 60) {
  const batch = todo.slice(i, i + 60);
  const resp = await client.chat.completions.create({
    model, temperature: 0.1, response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify(batch.map(b => ({ id: b.id, org: b.org, title: b.title }))) }],
  });
  for (const r of (JSON.parse(resp.choices[0].message.content || '{}').results || [])) res.set(r.id, { ...r, src: 'gpt' });
}
const out = g2b.map((it, i) => ({ ...it, v2: res.get('g' + i) || null }));
fs.writeFileSync(SC + 'gpt_th_v2.json', JSON.stringify(out, null, 1));
const cnt = {}; for (const o of out) { const g = o.v2?.grade || '?'; cnt[g] = (cnt[g] || 0) + 1; }
console.log('rule A:', ruleA.length, '| gpt input:', todo.length, '| grades:', JSON.stringify(cnt));
console.log('\n[B 등급 — 권역]');
for (const o of out) if (o.v2?.grade === 'B') console.log(' ', o.date.slice(0, 10), '|', o.agency.slice(0, 14), '|', o.name.slice(0, 60), '|', o.v2.type);
console.log('\n[GPT 가 A 준 것 — 규칙이 놓친 태국 명시]');
for (const o of out) if (o.v2?.grade === 'A' && o.v2.src === 'gpt') console.log(' ', o.name.slice(0, 70), '|', o.v2.reason);
console.log('\n[키워드별 A+B / 전체]');
const kc = {}; for (const o of out) for (const k of o.kws) { kc[k] = kc[k] || [0, 0]; kc[k][1]++; if (['A', 'B'].includes(o.v2?.grade)) kc[k][0]++; }
for (const [k, v] of Object.entries(kc).sort((a, b) => b[1][1] - a[1][1])) console.log(`  ${k.padEnd(12)} ${v[0]}/${v[1]}`);
