// 기존 attendance_records 전부 judgeV1 재계산 (holidays 반영).
// manual_override=1 인 건 보존됨.

import 'dotenv/config';
import { recomputeAllAttendanceJudgments } from './lib/db.js';

const r = await recomputeAllAttendanceJudgments();
console.log(`재계산 ${r.updated} 건`);
console.log(`  통과 ${r.stats.pass} / 지각 ${r.stats.late} / 주말·공휴일 ${r.stats.skip}`);
process.exit(0);
