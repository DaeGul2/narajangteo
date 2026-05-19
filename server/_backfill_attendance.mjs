// 5월 데이터 백필 — 일자별 쪼개서 17:00 captured_at 으로 createAttendanceSnapshot 호출.
// production 로직(createAttendanceSnapshot + judgeV1) 그대로 사용 → 100% 일치.

import 'dotenv/config';
import XLSX from 'xlsx';
import path from 'node:path';
import { createAttendanceSnapshot } from './lib/db.js';

const FILE = process.argv[2] || 'C:\\Users\\alsxo\\Downloads\\All_commute_2026-05-01_2026-05-18.xls';

const EXCEL_KEYS = [
  'date', 'name', 'emp_no', 'dept', 'position', 'work_type',
  'check_in_time', 'check_in_outside', 'check_out_time', 'check_out_outside',
  'commute_status', 'work_status',
];

const wb = XLSX.readFile(FILE);
const ws = wb.Sheets[wb.SheetNames[0]];
const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

// 헤더 3행 + 데이터
const rows = aoa.slice(3)
  .filter(r => Array.isArray(r) && r[0])
  .map(r => {
    const o = {};
    for (let i = 0; i < EXCEL_KEYS.length; i++) o[EXCEL_KEYS[i]] = String(r[i] ?? '').trim();
    return o;
  });

console.log(`[backfill] ${path.basename(FILE)} — ${rows.length} 행 로드`);

// 일자별 그룹 (YYYY-MM-DD prefix)
const byDate = new Map();
for (const r of rows) {
  const key = String(r.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
  if (!byDate.has(key)) byDate.set(key, []);
  byDate.get(key).push(r);
}
const dates = [...byDate.keys()].sort();
console.log(`[backfill] ${dates.length} 일치 — ${dates[0]} ~ ${dates[dates.length - 1]}`);

const totals = { snapshots: 0, rows: 0, pass: 0, late: 0, skip: 0 };

for (const date of dates) {
  const dayRows = byDate.get(date);
  const capturedAt = `${date} 17:00:00`;
  try {
    const saved = await createAttendanceSnapshot({
      capturedAt,
      excelFilename: `Backfill_${path.basename(FILE)}`,
      note: `백필 — ${date} 17:00 EOD 시뮬레이션`,
      rows: dayRows,
    });
    const js = saved.judgmentStats || { pass: 0, late: 0, skip: 0 };
    console.log(
      `  ${date} → #${saved.id} | 매칭 ${saved.rowCount}/${dayRows.length} (skip ${saved.skippedCount}) | 통과 ${js.pass} / 지각 ${js.late} / 주말 ${js.skip}`
    );
    if (saved.skippedNames?.length) {
      console.log(`    skipped names: ${saved.skippedNames.map(s => `${s.name}×${s.count}`).join(', ')}`);
    }
    totals.snapshots++;
    totals.rows += saved.rowCount;
    totals.pass += js.pass; totals.late += js.late; totals.skip += js.skip;
  } catch (e) {
    console.error(`  ${date} ❌ ${e.message}`);
  }
}

console.log('\n────── 합계 ──────');
console.log(`스냅샷 ${totals.snapshots}개 / 레코드 ${totals.rows}개`);
console.log(`통과 ${totals.pass} / 지각 ${totals.late} / 주말 ${totals.skip}`);

process.exit(0);
