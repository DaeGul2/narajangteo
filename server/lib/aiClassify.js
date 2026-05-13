// GPT로 공고를 "채용대행" vs "기타 채용업무 아웃소싱" 정밀 분류
// 배치 50건 단위 호출.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.resolve(__dirname, '../../_ncs_data/ai_classify_cache.json');

let _cache = null;
function loadCache() {
  if (_cache) return _cache;
  try {
    if (fs.existsSync(CACHE_PATH)) {
      _cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
    } else {
      _cache = {};
    }
  } catch (_) {
    _cache = {};
  }
  return _cache;
}

function saveCache() {
  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify(_cache, null, 2), 'utf-8');
  } catch (e) {
    console.error('[aiClassify] cache save failed:', e.message);
  }
}

const SYSTEM =
  '당신은 한국 정부·공공기관 입찰공고를 "채용대행 용역"인지 "그 외 채용업무 아웃소싱(상담/교육/시스템/박람회/조사 등)"인지 ' +
  '판단하는 전문가입니다. 채용대행은 공공기관을 대신해 채용 과정(공고/접수/필기/면접/평가 등) 전반을 위탁받아 ' +
  '대행 수행하는 용역입니다. 단순 채용 시스템 개발/임대, 박람회 운영, 채용 후 교육, 통계 조사, 홍보·캠페인은 채용대행이 아닙니다.';

function buildPrompt(items) {
  return `다음 공고 리스트 각각에 대해 "채용대행 용역" 여부를 판단해주세요.

[채용대행]
- 핵심 키워드: 채용대행, 채용 위탁, 채용 위탁 운영, 채용 전형 운영, 시험 운영 대행
- 공고 전 과정(서류·필기·면접) 또는 일부 단계를 외주 업체가 운영
- "○○ 채용 위탁용역", "신규직원 채용대행 용역", "정기채용 시험운영 대행" 등

[채용대행 아님 (Other)]
- 채용 시스템 개발/임대/운영, 상담·코칭 서비스
- 채용박람회, 취업 박람회, 잡페어 운영
- 신규자 교육, 직무교육
- 채용 통계 조사, AI 채용 연구
- 채용 활성화 홍보, 캠페인, 다양성·평등 캠페인
- 통합역량검사, 인적성검사 시스템
- 채용·인재 데이터 분석

[입력 공고 리스트]
${JSON.stringify(items.map(i => ({ id: i.id, name: i.name })), null, 2)}

[출력 — 반드시 JSON]
{
  "results": [
    { "id": "<입력 id>", "isAgent": <true|false>, "reason": "<한 줄 근거>" },
    ...
  ]
}
모든 입력에 대해 빠짐없이 응답하세요.`;
}

/**
 * @param {Array<{id: string, name: string}>} items
 * @returns {Promise<Map<string, {isAgent: boolean, reason: string}>>}
 */
export async function classifyBatch(items) {
  loadCache();
  const key = process.env.OPENAI_API_KEY;
  const out = new Map();
  if (!key) {
    // 키 없음 → 빈 결과
    return out;
  }

  // 캐시에서 우선 채우기
  const todo = [];
  for (const it of items) {
    const cached = _cache[it.name];
    if (cached) {
      out.set(it.id, cached);
    } else {
      todo.push(it);
    }
  }
  if (todo.length === 0) return out;

  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: key });
  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
  const BATCH = 50;

  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    try {
      const resp = await client.chat.completions.create({
        model,
        temperature: 0.1,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: buildPrompt(batch) },
        ],
        response_format: { type: 'json_object' },
      });
      const data = JSON.parse(resp.choices?.[0]?.message?.content || '{}');
      const results = data.results || [];
      for (const r of results) {
        const item = batch.find(b => b.id === r.id);
        if (!item) continue;
        const v = { isAgent: !!r.isAgent, reason: r.reason || '' };
        _cache[item.name] = v;
        out.set(r.id, v);
      }
    } catch (e) {
      console.error('[aiClassify] batch failed:', e.message);
    }
  }
  saveCache();
  return out;
}
