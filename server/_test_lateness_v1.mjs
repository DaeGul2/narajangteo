// 룰 v1 — 예전 데이터 (출퇴근관리/원본_엑셀/All_commute_*.xls) 에 적용
// 결과: caseId 별 분포 + 지각/통과/미정의 카운트 + 샘플 케이스 출력

import XLSX from 'xlsx';
import path from 'node:path';
import url from 'node:url';
import { parseWorkStatus } from './lib/attendanceParser.js';
import { judgeV1, codeOf } from './lib/attendanceLateness.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', '출퇴근관리', '원본_엑셀');
const FILES = [
  'All_commute_2024-10-01_2025-10-01.xls',
  'All_commute_2025-10-01_2026-04-24.xls',
];

const EXCEL_KEYS = [
  'date', 'name', 'emp_no', 'dept', 'position', 'work_type',
  'check_in_time', 'check_in_outside', 'check_out_time', 'check_out_outside',
  'commute_status', 'work_status',
];

function loadRows(file) {
  const wb = XLSX.readFile(file);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  // 헤더 3행 스킵, 데이터 4행부터 (index 3)
  return aoa.slice(3)
    .filter(r => Array.isArray(r) && r[0])
    .map(r => {
      const o = {};
      for (let i = 0; i < EXCEL_KEYS.length; i++) o[EXCEL_KEYS[i]] = String(r[i] ?? '').trim();
      return o;
    });
}

const all = [];
for (const f of FILES) {
  const p = path.join(DATA_DIR, f);
  const rows = loadRows(p);
  console.log(`로드: ${f} — ${rows.length} 행`);
  all.push(...rows);
}
console.log(`총 ${all.length} 행\n`);

// 통계
const stat = {
  total: all.length,
  empty_work_status: 0,
  with_work_status: 0,
  pass: 0,
  late: 0,
  undef: 0,
  byCase: new Map(),
  byMailplug: new Map(),     // 메일플러그 commute_status 분포
  byMatch: new Map(),        // {mailplug_status} -> {v1_pass} -> count
};

const undefSamples = [];
const lateSamples = [];
const mismatchSamples = []; // 메일플러그 '정상' 인데 우리가 지각 (또는 반대)

for (const r of all) {
  const items = parseWorkStatus(r.work_status);
  const result = judgeV1({ check_in_time: r.check_in_time, items, date: r.date });

  if (!r.work_status || r.work_status === '-') stat.empty_work_status++;
  else stat.with_work_status++;

  if (result.pass === true) stat.pass++;
  else if (result.pass === false) stat.late++;
  else stat.undef++;

  // case 분포
  stat.byCase.set(result.caseId, (stat.byCase.get(result.caseId) || 0) + 1);

  // 메일플러그 상태
  const mp = r.commute_status || '-';
  stat.byMailplug.set(mp, (stat.byMailplug.get(mp) || 0) + 1);

  // match table
  const k = `${mp}__${result.pass === true ? 'PASS' : result.pass === false ? 'LATE' : 'UNDEF'}`;
  stat.byMatch.set(k, (stat.byMatch.get(k) || 0) + 1);

  // 샘플
  if (result.pass === null && undefSamples.length < 20) {
    undefSamples.push({ r, result, codes: items.map(codeOf) });
  }
  if (result.pass === false && lateSamples.length < 30) {
    lateSamples.push({ r, result });
  }
  if (mp === '정상' && result.pass === false && mismatchSamples.length < 30) {
    mismatchSamples.push({ r, result, kind: '메일플러그=정상, v1=지각' });
  }
  if (mp === '지각' && result.pass === true && mismatchSamples.length < 60) {
    mismatchSamples.push({ r, result, kind: '메일플러그=지각, v1=통과' });
  }
}

console.log('────── 요약 ──────');
console.log(`총 ${stat.total} 행`);
console.log(`  근무상태 빈: ${stat.empty_work_status}`);
console.log(`  근무상태 있음: ${stat.with_work_status}`);
console.log(`  v1 PASS:  ${stat.pass}`);
console.log(`  v1 LATE:  ${stat.late}`);
console.log(`  v1 UNDEF: ${stat.undef}`);

console.log('\n────── case 분포 (top 30) ──────');
const sortedCases = [...stat.byCase.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
for (const [k, n] of sortedCases) console.log(`  ${k.padEnd(15)}: ${n}`);

console.log('\n────── 메일플러그 commute_status 분포 ──────');
for (const [k, n] of [...stat.byMailplug.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(12)}: ${n}`);
}

console.log('\n────── 매칭 매트릭스 (mailplug × v1) ──────');
const keys = [...stat.byMatch.entries()].sort((a, b) => b[1] - a[1]);
for (const [k, n] of keys) console.log(`  ${k.padEnd(30)}: ${n}`);

if (undefSamples.length > 0) {
  console.log('\n────── v1 미정의 샘플 (최대 20) ──────');
  for (const s of undefSamples) {
    console.log(`  ${s.r.date} ${s.r.name} | check_in=${s.r.check_in_time || '-'} | ws="${s.r.work_status.replace(/\n/g, ' | ')}" | codes=[${s.codes.join(',')}] | reason=${s.result.reason}`);
  }
}

if (mismatchSamples.length > 0) {
  console.log('\n────── 메일플러그 vs v1 불일치 샘플 ──────');
  for (const s of mismatchSamples.slice(0, 30)) {
    console.log(`  [${s.kind}]`);
    console.log(`    ${s.r.date} ${s.r.name} | check_in=${s.r.check_in_time || '-'} | ws="${(s.r.work_status || '').replace(/\n/g, ' | ')}"`);
    console.log(`    → caseId=${s.result.caseId}, reason=${s.result.reason}`);
  }
}
