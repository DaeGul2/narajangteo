import 'dotenv/config';
import fs from 'node:fs';
import OpenAI from 'openai';
const SC = 'C:/Users/alsxo/AppData/Local/Temp/claude/C--Users-alsxo-Documents-GitHub-narajangteo/1849a866-02c3-4c1e-86d5-82ebefb98459/scratchpad/';
const g2b = JSON.parse(fs.readFileSync(SC + 'g2b_th_test.json', 'utf8')).items;
const ov = JSON.parse(fs.readFileSync(SC + 'overseas_dump.json', 'utf8')).notices;
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

const SYSTEM = `당신은 태국(Thailand)에 법인을 둔 한국계 행사·마케팅·용역 회사의 영업 담당입니다.
한국 공공기관 공고 제목을 보고 "우리 회사가 봐야 할 태국 관련 공고인지" 판단합니다.

[태국 관련 = true 로 보는 기준 — 넓게 잡을 것]
- 사업 장소, 대상 국가, 참가자, 바이어, 계약 상대, 파견지 중 하나라도 태국(방콕·치앙마이·푸켓·파타야 등 태국 도시 포함)이면 true
- 한국에서 하든 태국에서 하든 상관없음 (태국 바이어 한국 초청, 태국 인플루언서 방한 등도 true)
- "동남아", "아세안(ASEAN)", "동남아시아", "메콩" 처럼 태국이 포함될 가능성이 높은 권역 사업도 true (단, 국가가 명시돼 있고 태국이 빠져 있으면 false)
- THAIFEX, Gastech Bangkok, Metalex, WHX Bangkok, Cosmoprof CBE ASEAN, SEOUL FOOD in Bangkok, IMPACT/BITEC/QSNCC 등 태국 개최 전시·행사명이면 true
- 애매하면 true (놓치는 것이 오탐보다 훨씬 나쁨)

[false]
- 태국·동남아와 무관한 국가·지역 (인도, 일본, 미국, 유럽, 중동, 아프리카, 중앙아시아 등만 명시)
- 단어가 우연히 겹친 것 (임팩트 소켓, 바이텍 시약, With AI 등)
- 국내 전용 사업

[opportunity — 공고 유형]
- "용역": 우리 같은 업체가 입찰·제안할 수 있는 용역·대행·위탁·공사·구매 (운영대행, 부스 장치, 상담회 운영, 연수 프로그램 등)
- "모집": 참가기업·참여기업·수행기관·파트너 모집 (우리가 응모 가능할 수도 있음)
- "채용": 직원 채용
- "안내": 행사 안내·결과 발표·설문 등 영업 기회 아님

[출력 — JSON]
{"results":[{"id":"<id>","thai":true|false,"conf":"high|mid|low","type":"용역|모집|채용|안내","topic":"<10자 내외 주제>","reason":"<한 줄>"}]}
모든 입력에 빠짐없이 응답.`;

async function run(items, label) {
  const out = [];
  for (let i = 0; i < items.length; i += 60) {
    const batch = items.slice(i, i + 60);
    const resp = await client.chat.completions.create({
      model, temperature: 0.1, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify(batch.map(b => ({ id: b.id, org: b.org, title: b.title }))) }],
    });
    const r = JSON.parse(resp.choices[0].message.content || '{}').results || [];
    out.push(...r);
    process.stdout.write(`${label} ${Math.min(i + 60, items.length)}/${items.length}\r`);
  }
  console.log();
  return new Map(out.map(r => [r.id, r]));
}

const gIn = g2b.map((it, i) => ({ id: 'g' + i, org: it.agency, title: it.name }));
const gMap = await run(gIn, 'g2b');
const gRes = g2b.map((it, i) => ({ ...it, ai: gMap.get('g' + i) || null }));

const oIn = ov.map((it, i) => ({ id: 'o' + i, org: it.organization, title: it.title }));
const oMap = await run(oIn, 'overseas');
const oRes = ov.map((it, i) => ({ ...it, ai: oMap.get('o' + i) || null }));

fs.writeFileSync(SC + 'gpt_th_result.json', JSON.stringify({ g2b: gRes, overseas: oRes }, null, 1));
console.log('done');
