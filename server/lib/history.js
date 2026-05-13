// 공공기관 이전 채용대행 기록 조회
// 1차: 정확 일치, 2차: 공백/기호 정규화 일치, 3차: 부분 일치, 4차: GPT fuzzy 매칭

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_PATH = path.resolve(__dirname, '../../_ncs_data/agency_history.json');
const GPT_CACHE_PATH = path.resolve(__dirname, '../../_ncs_data/gpt_inst_match_cache.json');

let _history = null;
let _historyKeys = null;
let _normIndex = null;  // normalized → original key
let _gptCache = {};

function loadHistory() {
  if (_history) return _history;
  try {
    _history = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8'));
    _historyKeys = Object.keys(_history);
    _normIndex = new Map();
    for (const k of _historyKeys) {
      _normIndex.set(normalize(k), k);
    }
    console.log(`[history] loaded ${_historyKeys.length} institutions`);
  } catch (e) {
    console.error('[history] load failed:', e.message);
    _history = {};
    _historyKeys = [];
    _normIndex = new Map();
  }
  // GPT 캐시 로드
  try {
    if (fs.existsSync(GPT_CACHE_PATH)) {
      _gptCache = JSON.parse(fs.readFileSync(GPT_CACHE_PATH, 'utf-8'));
    }
  } catch (_) {}
  return _history;
}

function saveGptCache() {
  try {
    fs.writeFileSync(GPT_CACHE_PATH, JSON.stringify(_gptCache, null, 2), 'utf-8');
  } catch (e) {
    console.error('[history] gpt cache save failed:', e.message);
  }
}

function normalize(s) {
  return (s || '').replace(/[\s·\-_(),.'"]+/g, '').toLowerCase();
}

function aggregateByYear(records) {
  const byYear = new Map();
  for (const r of records) {
    if (!byYear.has(r.year)) byYear.set(r.year, new Set());
    byYear.get(r.year).add(r.agency);
  }
  return Array.from(byYear.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([year, agencies]) => ({ year, agencies: Array.from(agencies) }));
}

// GPT로 fuzzy 매칭 (이전 700개 기관 후보 중 가장 가까운 1개 또는 없음)
async function gptMatch(target) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  if (_gptCache[target] !== undefined) return _gptCache[target];

  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: key });
  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

  // 후보 풀: 모든 기관명
  const candidates = _historyKeys;

  try {
    const resp = await client.chat.completions.create({
      model,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            '당신은 한국 공공기관·공기업·재단·공공단체의 정식 명칭을 정확히 식별하는 전문가입니다. ' +
            '약자/별칭/정식명/명칭변경을 고려해 같은 기관 여부를 판단합니다.',
        },
        {
          role: 'user',
          content:
            `대상 기관: ${JSON.stringify(target)}\n\n` +
            `후보 리스트 중에서 대상 기관과 **동일한 기관**(약자/별칭/명칭변경 포함)을 1개 선택하세요. ` +
            `없으면 빈 문자열로 응답.\n\n` +
            `후보 (총 ${candidates.length}개):\n${JSON.stringify(candidates)}\n\n` +
            `반드시 JSON으로 응답: {"match": "<후보 중 정확한 표기 또는 빈 문자열>", "reason": "<짧게>"}`,
        },
      ],
      response_format: { type: 'json_object' },
    });
    const result = JSON.parse(resp.choices?.[0]?.message?.content || '{}');
    const matched = (result.match || '').trim();
    if (matched && _normIndex.get(normalize(matched))) {
      _gptCache[target] = matched;
    } else {
      _gptCache[target] = '';
    }
    saveGptCache();
    return _gptCache[target] || null;
  } catch (e) {
    console.error('[history] gpt match failed:', e.message);
    return null;
  }
}

/**
 * @param {string} institutionName - 디테일 API의 수요기관명 (dmstUntyGrpNm 등)
 * @param {string} currentBidYear - 현재 공고 연도 (이 연도는 결과에서 제외)
 * @returns {Promise<{matched: string|null, history: Array<{year: string, agencies: string[]}>}>}
 */
export async function findPreviousAgencies(institutionName, currentBidYear = '') {
  loadHistory();
  if (!institutionName) return { matched: null, history: [] };

  // 1. 정확 일치
  if (_history[institutionName]) {
    return { matched: institutionName, history: filterAndAgg(_history[institutionName], currentBidYear) };
  }
  // 2. 정규화 일치
  const norm = normalize(institutionName);
  const exactKey = _normIndex.get(norm);
  if (exactKey) {
    return { matched: exactKey, history: filterAndAgg(_history[exactKey], currentBidYear) };
  }
  // 3. 부분 일치 (한쪽이 다른 쪽 prefix + 길이차 작은 경우)
  for (const k of _historyKeys) {
    const kn = normalize(k);
    if ((kn.startsWith(norm) || norm.startsWith(kn)) && Math.abs(kn.length - norm.length) <= 4) {
      return { matched: k, history: filterAndAgg(_history[k], currentBidYear) };
    }
  }
  // 4. GPT fuzzy 매칭
  const gptKey = await gptMatch(institutionName);
  if (gptKey && _history[gptKey]) {
    return { matched: gptKey, history: filterAndAgg(_history[gptKey], currentBidYear) };
  }
  return { matched: null, history: [] };
}

function filterAndAgg(records, excludeYear) {
  const filtered = excludeYear
    ? records.filter(r => r.year !== String(excludeYear))
    : records;
  return aggregateByYear(filtered);
}
