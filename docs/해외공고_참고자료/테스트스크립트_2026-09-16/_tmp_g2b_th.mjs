import 'dotenv/config';
import fs from 'node:fs';
import { callSearchApi } from './lib/g2bApi.js';
import { clean, normalizeBidNo, money } from './lib/utils.js';

const OUT = 'C:/Users/alsxo/AppData/Local/Temp/claude/C--Users-alsxo-Documents-GitHub-narajangteo/1849a866-02c3-4c1e-86d5-82ebefb98459/scratchpad/g2b_th_test.json';
const DAYS = Number(process.argv[2] || 365);
const KW = [
  // 국가·도시 (한글)
  '태국','방콕','치앙마이','푸켓','파타야','치앙라이','끄라비','후아힌','코사무이','아유타야',
  // 국가·도시 (영문)
  'Thailand','Thai','Bangkok','Chiang Mai','Phuket','Pattaya',
  // 컨벤션센터·전시
  'BITEC','IMPACT','QSNCC','퀸시리킷','바이텍','임팩트','THAIFEX','타이펙스',
  // 광역
  '동남아','아세안','ASEAN','동남아시아',
  // 행사 형식
  '한국관','K-푸드','K-Food','해외전시','해외 전시','수출상담회','무역사절단','시장개척단','해외마케팅','해외 마케팅','바이어',
];
const results = {};
const all = new Map();
for (const kw of KW) {
  try {
    const rows = await callSearchApi(kw, 500, DAYS);
    results[kw] = rows.length;
    for (const r of rows) {
      const bidNo = normalizeBidNo(r.bidPbancUntyNoOrd || r.bidPbancNo || r.untyBidPbancNo);
      if (!all.has(bidNo)) all.set(bidNo, {
        bidNo, name: clean(r.bidPbancNm), agency: clean(r.oderInstUntyGrpNm || r.instNm), demander: clean(r.dmstNm),
        date: clean(r.pbancPstgDt), deadline: clean(r.bidPbancLastRcptYmd), status: clean(r.pbancSttsNm),
        bgtAmt: money(r.alotBgtAmt), prspPrce: money(r.prspPrce), ovrs: clean(r.dmstcOvrsSeCd || r.dmstcOvrsSeNm), kws: [],
      });
      all.get(bidNo).kws.push(kw);
    }
  } catch (e) { results[kw] = 'ERR ' + e.message; }
}
// 샘플 1행 raw 키 확인
const sample = await callSearchApi('태국', 3, DAYS);
fs.writeFileSync(OUT, JSON.stringify({ days: DAYS, counts: results, items: [...all.values()], rawKeys: sample[0] ? Object.keys(sample[0]) : [], rawSample: sample[0] || null }, null, 1));
console.log('COUNTS', JSON.stringify(results));
console.log('UNIQUE', all.size);
