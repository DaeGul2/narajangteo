// RDS MySQL 커넥션 풀 + 헬퍼

import 'dotenv/config';
import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  timezone: '+09:00',
  dateStrings: true,   // DATE/DATETIME 을 문자열로 반환 (timezone 변환 X)
});

export default pool;

// ─── app_secrets — 단순 key/value (메일플러그 쿠키 등) ───
export async function getSecret(key) {
  const [[row]] = await pool.query(
    'SELECT k, v, note, updated_at, last_used_at FROM app_secrets WHERE k = ?',
    [key]
  );
  return row || null;
}
export async function setSecret(key, value, note = null) {
  await pool.execute(
    `INSERT INTO app_secrets (k, v, note) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE v = VALUES(v), note = VALUES(note)`,
    [key, value, note]
  );
}
export async function touchSecret(key) {
  await pool.execute(
    'UPDATE app_secrets SET last_used_at = NOW() WHERE k = ?',
    [key]
  );
}

// ─── 출퇴근 스냅샷 ───
import { parseWorkStatus } from './attendanceParser.js';
import { judgeV1 } from './attendanceLateness.js';

// items DB row → judgeV1 가 기대하는 shape
function itemRowToJudge(it) {
  return {
    category: it.category,
    subType: it.sub_type,
    rangeType: it.range_type,
    startTime: it.start_time,
    endTime: it.end_time,
    startDate: it.start_date,
    endDate: it.end_date,
    durationMinutes: it.duration_minutes,
    raw: it.raw,
  };
}

// ─── holidays ─── (judgeV1 평가 시 skip 할 날들)
export async function listHolidays() {
  const [rows] = await pool.query(
    `SELECT date, name, source, created_at FROM holidays ORDER BY date`
  );
  return rows;
}
export async function addHoliday(date, name, source = 'manual') {
  await pool.execute(
    `INSERT INTO holidays (date, name, source) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), source = VALUES(source)`,
    [date, name, source]
  );
}
export async function deleteHoliday(date) {
  await pool.execute(`DELETE FROM holidays WHERE date = ?`, [date]);
}
// "YYYY-MM-DD" → name 의 Map
async function getHolidayMap() {
  const [rows] = await pool.query(`SELECT date, name FROM holidays`);
  const m = new Map();
  for (const r of rows) m.set(String(r.date).slice(0, 10), r.name);
  return m;
}

const REC_COLS = [
  'date','name','emp_no','dept','position','work_type',
  'check_in_time','check_in_outside','check_out_time','check_out_outside',
  'commute_status','work_status',
];

// bid_employees.name 인덱스 — 공백 제거 버전까지 같이.
// attendance_target = 1 인 직원만 포함 (크롤 평가 대상).
async function buildEmployeeNameMap(conn) {
  const [rows] = await conn.query(
    'SELECT id, name FROM bid_employees WHERE attendance_target = 1'
  );
  const map = new Map();
  for (const r of rows) {
    const n = (r.name || '').trim();
    if (!n) continue;
    if (!map.has(n)) map.set(n, r.id);
    const compact = n.replace(/\s+/g, '');
    if (!map.has(compact)) map.set(compact, r.id);
  }
  return map;
}

export async function createAttendanceSnapshot({ capturedAt, excelFilename, note, rows }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 직원 매핑 — bid_employees 에 있는 이름만 통과
    const nameMap = await buildEmployeeNameMap(conn);
    // 공휴일 — judgeV1 평가 시 skip
    const holidays = await getHolidayMap();
    const matched = [];
    const skipped = [];
    for (const r of rows) {
      const name = (r.name || '').toString().trim();
      if (!name) { skipped.push({ name: '', reason: 'empty name' }); continue; }
      const empId = nameMap.get(name) || nameMap.get(name.replace(/\s+/g, ''));
      if (!empId) { skipped.push({ name, reason: 'no match' }); continue; }
      matched.push({ ...r, employee_id: empId });
    }

    const [snapIns] = await conn.execute(
      `INSERT INTO attendance_snapshots (captured_at, row_count, excel_filename, note)
       VALUES (?, ?, ?, ?)`,
      [capturedAt, matched.length, excelFilename || null, note || null]
    );
    const snapshotId = snapIns.insertId;

    let statusItemCount = 0;
    let lateCount = 0, passCount = 0, skipCount = 0;
    for (let idx = 0; idx < matched.length; idx++) {
      const r = matched[idx];
      const items = parseWorkStatus(r.work_status);
      // 지각 판정 — judgeV1
      const j = judgeV1({ check_in_time: r.check_in_time, items, date: r.date, holidays });
      // is_late: pass=0 / fail=1 / skip(주말)=null
      const isLate = j.skip ? null : (j.pass ? 0 : 1);
      if (j.skip) skipCount++;
      else if (j.pass) passCount++;
      else lateCount++;

      const [recIns] = await conn.execute(
        `INSERT INTO attendance_records
           (snapshot_id, employee_id, row_index, ${REC_COLS.join(', ')},
            is_late, late_case_id, late_reason, late_deadline)
         VALUES (?, ?, ?, ${REC_COLS.map(() => '?').join(', ')}, ?, ?, ?, ?)`,
        [
          snapshotId, r.employee_id, idx,
          ...REC_COLS.map(c => r[c] == null ? null : String(r[c])),
          isLate, j.caseId, j.reason, j.deadline,
        ]
      );
      const recordId = recIns.insertId;
      r.judgment = { ...j, isLate, recordId };

      if (items.length > 0) {
        const placeholders = items.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
        const params = [];
        for (const it of items) {
          params.push(
            recordId, it.itemIndex, it.category,
            it.subType, it.rangeType,
            it.startTime, it.endTime,
            it.startDate, it.endDate,
            it.durationMinutes,
            it.raw,
          );
        }
        await conn.execute(
          `INSERT INTO attendance_status_items
             (record_id, item_index, category, sub_type, range_type,
              start_time, end_time, start_date, end_date, duration_minutes, raw)
           VALUES ${placeholders}`,
          params
        );
        statusItemCount += items.length;
      }
    }

    await conn.commit();
    // skipped 이름 중복 제거 (집계용)
    const skipNameCount = new Map();
    for (const s of skipped) {
      if (!s.name) continue;
      skipNameCount.set(s.name, (skipNameCount.get(s.name) || 0) + 1);
    }
    return {
      id: snapshotId,
      rowCount: matched.length,
      skippedCount: skipped.length,
      skippedNames: [...skipNameCount.entries()].map(([name, count]) => ({ name, count })),
      statusItemCount,
      matchedRows: matched,
      judgmentStats: { pass: passCount, late: lateCount, skip: skipCount },
    };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
export async function listAttendanceSnapshots(limit = 50) {
  const [rows] = await pool.query(
    `SELECT id, captured_at, row_count, excel_filename, note, created_at
     FROM attendance_snapshots
     ORDER BY captured_at DESC, id DESC
     LIMIT ?`,
    [limit]
  );
  return rows;
}
export async function getAttendanceSnapshot(id) {
  const [[snap]] = await pool.query(
    `SELECT id, captured_at, row_count, excel_filename, note, created_at
     FROM attendance_snapshots WHERE id = ?`, [id]
  );
  if (!snap) return null;
  const [recs] = await pool.query(
    `SELECT r.id, r.row_index, r.employee_id, e.name AS employee_name,
            ${REC_COLS.map(c => 'r.' + c).join(', ')},
            r.is_late, r.late_case_id, r.late_reason, r.late_deadline,
            r.manual_override, r.manual_note
     FROM attendance_records r
     LEFT JOIN bid_employees e ON e.id = r.employee_id
     WHERE r.snapshot_id = ? ORDER BY r.row_index`,
    [id]
  );
  // status_items 한 번에 가져와서 record 별로 묶음
  const recordIds = recs.map(r => r.id);
  let itemsByRecord = new Map();
  if (recordIds.length > 0) {
    const [items] = await pool.query(
      `SELECT record_id, item_index, category, sub_type, range_type,
              start_time, end_time, start_date, end_date, duration_minutes, raw
       FROM attendance_status_items
       WHERE record_id IN (?)
       ORDER BY record_id, item_index`,
      [recordIds]
    );
    for (const it of items) {
      const arr = itemsByRecord.get(it.record_id) || [];
      arr.push(it);
      itemsByRecord.set(it.record_id, arr);
    }
  }
  const rows = recs.map(r => ({
    ...r,
    items: itemsByRecord.get(r.id) || [],
  }));
  return { snapshot: snap, rows };
}
export async function deleteAttendanceSnapshot(id) {
  await pool.execute('DELETE FROM attendance_snapshots WHERE id = ?', [id]);
}

// 단건 record 의 지각 판정 수정 (수동 override)
//   patch: { is_late?, manual_note?, reset? }
//   reset=true 면 manual_override 해제 + judgeV1 재계산
export async function updateAttendanceRecord(recordId, patch) {
  const [[rec]] = await pool.query(
    `SELECT id, snapshot_id, date, check_in_time FROM attendance_records WHERE id = ?`,
    [recordId]
  );
  if (!rec) return null;

  if (patch.reset) {
    // judgeV1 재계산
    const [items] = await pool.query(
      `SELECT * FROM attendance_status_items WHERE record_id = ? ORDER BY item_index`,
      [recordId]
    );
    const judgeItems = items.map(itemRowToJudge);
    const holidays = await getHolidayMap();
    const j = judgeV1({ check_in_time: rec.check_in_time, items: judgeItems, date: rec.date, holidays });
    const isLate = j.skip ? null : (j.pass ? 0 : 1);
    await pool.execute(
      `UPDATE attendance_records SET
         is_late = ?, late_case_id = ?, late_reason = ?, late_deadline = ?,
         manual_override = 0, manual_note = NULL
       WHERE id = ?`,
      [isLate, j.caseId, j.reason, j.deadline, recordId]
    );
    return { ok: true, mode: 'reset', judgment: { ...j, isLate } };
  }

  // 수동 수정
  const sets = [];
  const params = [];
  if (Object.prototype.hasOwnProperty.call(patch, 'is_late')) {
    sets.push('is_late = ?');
    params.push(patch.is_late);   // 0 | 1 | null
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'manual_note')) {
    sets.push('manual_note = ?');
    params.push(patch.manual_note);
  }
  if (sets.length > 0) {
    sets.push('manual_override = 1');
    params.push(recordId);
    await pool.execute(
      `UPDATE attendance_records SET ${sets.join(', ')} WHERE id = ?`,
      params
    );
  }
  return { ok: true, mode: 'manual' };
}

// 모든 record 의 지각 판정 재계산 (manual_override=0 만, holidays 변경 후 사용)
export async function recomputeAllAttendanceJudgments() {
  const holidays = await getHolidayMap();
  const [recs] = await pool.query(
    `SELECT id, date, check_in_time FROM attendance_records WHERE manual_override = 0`
  );
  const [itemRows] = await pool.query(
    `SELECT record_id, item_index, category, sub_type, range_type,
            start_time, end_time, start_date, end_date, duration_minutes, raw
       FROM attendance_status_items
      WHERE record_id IN (?)`,
    [recs.map(r => r.id).concat([0])]   // 0 placeholder for empty
  );
  const itemsByRec = new Map();
  for (const it of itemRows) {
    const arr = itemsByRec.get(it.record_id) || [];
    arr.push(it);
    itemsByRec.set(it.record_id, arr);
  }

  let updated = 0, changed = 0;
  const stats = { pass: 0, late: 0, skip: 0 };
  for (const r of recs) {
    const items = (itemsByRec.get(r.id) || []).map(itemRowToJudge);
    const j = judgeV1({ check_in_time: r.check_in_time, items, date: r.date, holidays });
    const isLate = j.skip ? null : (j.pass ? 0 : 1);
    await pool.execute(
      `UPDATE attendance_records SET
         is_late = ?, late_case_id = ?, late_reason = ?, late_deadline = ?
       WHERE id = ?`,
      [isLate, j.caseId, j.reason, j.deadline, r.id]
    );
    updated++;
    if (isLate === 0) stats.pass++;
    else if (isLate === 1) stats.late++;
    else stats.skip++;
  }
  return { updated, stats };
}

// 기간별 출퇴근 리포트
//   from / to : "YYYY-MM-DD" (inclusive)
//   같은 (employee_id, date) 가 여러 스냅샷에 있으면 가장 큰 record id 만 사용 (= 최신 크롤)
export async function getAttendanceReport(from, to) {
  // 1) 그 기간의 (employee_id, date) 별 최신 record id
  const [latestRows] = await pool.query(
    `SELECT MAX(id) AS max_id
       FROM attendance_records
      WHERE SUBSTRING(date, 1, 10) BETWEEN ? AND ?
      GROUP BY employee_id, SUBSTRING(date, 1, 10)`,
    [from, to]
  );
  const ids = latestRows.map(r => r.max_id).filter(Boolean);
  if (ids.length === 0) {
    return { period: { from, to }, peopleStats: [], lateRecords: [], totalEvaluated: 0 };
  }

  // 2) 그 record 들 + 직원명 (attendance_target=1 인 직원만)
  const [recs] = await pool.query(
    `SELECT r.id, r.snapshot_id, r.employee_id, r.date, r.check_in_time, r.check_out_time,
            r.commute_status, r.work_status,
            r.is_late, r.late_case_id, r.late_reason, r.late_deadline,
            r.manual_override, r.manual_note,
            e.name AS employee_name, e.position AS employee_position
       FROM attendance_records r
       JOIN bid_employees e ON e.id = r.employee_id
      WHERE r.id IN (?)
        AND e.attendance_target = 1
      ORDER BY e.name, SUBSTRING(r.date, 1, 10)`,
    [ids]
  );

  // 3) 지각 record 들의 items 만 fetch (사유 디스플레이용)
  const lateIds = recs.filter(r => r.is_late === 1).map(r => r.id);
  let itemsByRecord = new Map();
  if (lateIds.length > 0) {
    const [items] = await pool.query(
      `SELECT record_id, item_index, category, sub_type, range_type,
              start_time, end_time, start_date, end_date, duration_minutes, raw
         FROM attendance_status_items
        WHERE record_id IN (?)
        ORDER BY record_id, item_index`,
      [lateIds]
    );
    for (const it of items) {
      const arr = itemsByRecord.get(it.record_id) || [];
      arr.push(it);
      itemsByRecord.set(it.record_id, arr);
    }
  }

  // 4) 사람별 집계
  const byEmp = new Map();
  for (const r of recs) {
    const key = r.employee_id;
    if (!byEmp.has(key)) {
      byEmp.set(key, {
        employee_id: r.employee_id,
        name: r.employee_name,
        position: r.employee_position,
        evaluated: 0,
        pass: 0,
        late: 0,
        skip: 0,
        override: 0,
        caseBreakdown: {},
        lateRecords: [],
      });
    }
    const s = byEmp.get(key);
    s.evaluated++;
    if (r.is_late === 0) s.pass++;
    else if (r.is_late === 1) {
      s.late++;
      const k = r.late_case_id || '?';
      s.caseBreakdown[k] = (s.caseBreakdown[k] || 0) + 1;
      s.lateRecords.push({
        record_id: r.id,
        date: r.date,
        check_in_time: r.check_in_time,
        late_case_id: r.late_case_id,
        late_reason: r.late_reason,
        late_deadline: r.late_deadline,
        work_status: r.work_status,
        manual_override: r.manual_override,
        manual_note: r.manual_note,
        items: itemsByRecord.get(r.id) || [],
      });
    }
    else s.skip++;
    if (r.manual_override === 1) s.override++;
  }

  // 5) 케이스 전체 분포 (overview)
  const caseDistribution = {};
  for (const r of recs) {
    if (r.is_late !== 1) continue;
    const k = r.late_case_id || '?';
    caseDistribution[k] = (caseDistribution[k] || 0) + 1;
  }

  // 6) 일자별 — 그날 평가된 사람 수 / 지각 수
  const byDay = new Map();
  for (const r of recs) {
    const d = String(r.date).slice(0, 10);
    if (!byDay.has(d)) byDay.set(d, { date: d, evaluated: 0, pass: 0, late: 0, skip: 0 });
    const s = byDay.get(d);
    s.evaluated++;
    if (r.is_late === 0) s.pass++;
    else if (r.is_late === 1) s.late++;
    else s.skip++;
  }
  const days = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));

  return {
    period: { from, to },
    totalEvaluated: recs.length,
    totalLate: recs.filter(r => r.is_late === 1).length,
    totalPass: recs.filter(r => r.is_late === 0).length,
    totalSkip: recs.filter(r => r.is_late === null).length,
    totalOverride: recs.filter(r => r.manual_override === 1).length,
    peopleStats: [...byEmp.values()].sort((a, b) => b.late - a.late || a.name.localeCompare(b.name)),
    caseDistribution,
    days,
  };
}

// 자주 쓰는 헬퍼

export async function existsBidNos(bidNos) {
  if (!bidNos || bidNos.length === 0) return new Set();
  const [rows] = await pool.query(
    `SELECT bid_no FROM notices WHERE bid_no IN (?)`,
    [bidNos]
  );
  return new Set(rows.map(r => r.bid_no));
}

export async function insertNotice(rec) {
  const sql = `
    INSERT INTO notices (
      bid_no, name, agency, demander, bgt_amt, prsp_prce,
      scsbd_mthd, pnpr_mtho, pbanc_knd, status, posted_at, deadline,
      ai_is_agent, ai_reason, detail, prev_history, summary_md, files_meta,
      email_sent_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      ai_is_agent = VALUES(ai_is_agent),
      ai_reason   = VALUES(ai_reason),
      detail      = VALUES(detail),
      prev_history= VALUES(prev_history),
      summary_md  = VALUES(summary_md),
      files_meta  = VALUES(files_meta),
      email_sent_at = COALESCE(notices.email_sent_at, VALUES(email_sent_at))
  `;
  const params = [
    rec.bid_no, rec.name, rec.agency, rec.demander, rec.bgt_amt, rec.prsp_prce,
    rec.scsbd_mthd, rec.pnpr_mtho, rec.pbanc_knd, rec.status, rec.posted_at, rec.deadline,
    rec.ai_is_agent, rec.ai_reason,
    rec.detail ? JSON.stringify(rec.detail) : null,
    rec.prev_history ? JSON.stringify(rec.prev_history) : null,
    rec.summary_md, rec.files_meta ? JSON.stringify(rec.files_meta) : null,
    rec.email_sent_at,
  ];
  await pool.execute(sql, params);
}

// cron 스케줄 (단일행 id=1)
export async function getCronSettings() {
  const [rows] = await pool.query(
    `SELECT id, hour, minute, enabled, days_back, updated_at FROM cron_settings WHERE id = 1`
  );
  if (rows[0]) return rows[0];
  // 행이 없으면 기본값 생성
  await pool.execute(
    `INSERT IGNORE INTO cron_settings (id, hour, minute, enabled, days_back) VALUES (1, 11, 0, 1, 5)`
  );
  const [r2] = await pool.query(
    `SELECT id, hour, minute, enabled, days_back, updated_at FROM cron_settings WHERE id = 1`
  );
  return r2[0];
}

export async function updateCronSettings({ hour, minute, enabled, days_back }) {
  const sets = [];
  const params = [];
  if (hour !== undefined) {
    const h = Number(hour);
    if (!Number.isInteger(h) || h < 0 || h > 23) throw new Error('hour 는 0~23');
    sets.push('hour = ?'); params.push(h);
  }
  if (minute !== undefined) {
    const m = Number(minute);
    if (!Number.isInteger(m) || m < 0 || m > 59) throw new Error('minute 는 0~59');
    sets.push('minute = ?'); params.push(m);
  }
  if (enabled !== undefined) {
    sets.push('enabled = ?'); params.push(enabled ? 1 : 0);
  }
  if (days_back !== undefined) {
    const d = Number(days_back);
    if (!Number.isInteger(d) || d < 1 || d > 90) throw new Error('days_back 는 1~90');
    sets.push('days_back = ?'); params.push(d);
  }
  if (!sets.length) return;
  await pool.execute(`UPDATE cron_settings SET ${sets.join(', ')} WHERE id = 1`, params);
}

// cron 실행 로그
export async function startCronRun() {
  const [r] = await pool.execute(
    `INSERT INTO cron_runs (started_at, status) VALUES (NOW(), 'running')`
  );
  return r.insertId;
}

export async function finishCronRun(id, { status, totalFound, newCount, emailSent, errorMsg }) {
  await pool.execute(
    `UPDATE cron_runs
     SET finished_at = NOW(), status = ?, total_found = ?, new_count = ?, email_sent = ?, error_msg = ?
     WHERE id = ?`,
    [status, totalFound ?? null, newCount ?? null, emailSent ? 1 : 0, errorMsg ?? null, id]
  );
}

// 수신자 관리
export async function getActiveRecipients() {
  const [rows] = await pool.query(
    `SELECT email, name FROM recipients WHERE active = 1 ORDER BY id`
  );
  return rows;
}

export async function addRecipient(email, name = null) {
  await pool.execute(
    `INSERT INTO recipients (email, name) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), active = 1`,
    [email, name]
  );
}

export async function deactivateRecipient(email) {
  await pool.execute(
    `UPDATE recipients SET active = 0 WHERE email = ?`,
    [email]
  );
}

export async function updateRecipient(id, { email, name, active }) {
  const fields = [];
  const params = [];
  if (email !== undefined) { fields.push('email = ?'); params.push(email); }
  if (name !== undefined)  { fields.push('name = ?');  params.push(name); }
  if (active !== undefined){ fields.push('active = ?'); params.push(active ? 1 : 0); }
  if (!fields.length) return;
  params.push(id);
  await pool.execute(`UPDATE recipients SET ${fields.join(', ')} WHERE id = ?`, params);
}

// ─── 입찰 참여 인력 ───
const EMP_FIELDS = [
  'name','name_en','phone','email','birth_date','position','final_edu','school','major',
  'tech_grade','grad_year','grad_month','external_join_date','real_join_date','active',
  'attendance_target',
];

export async function listEmployees(includeInactive = true) {
  const where = includeInactive ? '' : 'WHERE active = 1';
  const [rows] = await pool.query(
    `SELECT id, ${EMP_FIELDS.join(', ')}, created_at, updated_at FROM bid_employees ${where} ORDER BY id`
  );
  return rows;
}

export async function getEmployee(id) {
  const [rows] = await pool.query(
    `SELECT id, ${EMP_FIELDS.join(', ')}, created_at, updated_at FROM bid_employees WHERE id = ?`,
    [id]
  );
  return rows[0] || null;
}

export async function addEmployee(payload) {
  const cols = [], vals = [], params = [];
  for (const f of EMP_FIELDS) {
    if (payload[f] !== undefined) {
      cols.push(f); vals.push('?'); params.push(payload[f] === '' ? null : payload[f]);
    }
  }
  if (!cols.length || !payload.name) throw new Error('name 필수');
  const [r] = await pool.execute(
    `INSERT INTO bid_employees (${cols.join(', ')}) VALUES (${vals.join(', ')})`,
    params
  );
  return r.insertId;
}

export async function updateEmployee(id, payload) {
  const sets = [], params = [];
  for (const f of EMP_FIELDS) {
    if (payload[f] !== undefined) {
      sets.push(`${f} = ?`); params.push(payload[f] === '' ? null : payload[f]);
    }
  }
  if (!sets.length) return;
  params.push(id);
  await pool.execute(
    `UPDATE bid_employees SET ${sets.join(', ')} WHERE id = ?`,
    params
  );
}

export async function deleteEmployee(id) {
  await pool.execute(`DELETE FROM bid_employees WHERE id = ?`, [id]);
}

// ─── 학력 / 경력 / 자격증 공용 CRUD 빌더 ───
function makeCrud(table, fields, ownerCol = 'employee_id', orderBy = 'sort_order, id') {
  return {
    listByOwner: async (ownerId) => {
      const [rows] = await pool.query(
        `SELECT id, ${ownerCol}, ${fields.join(', ')}, created_at, updated_at
         FROM ${table} WHERE ${ownerCol} = ? ORDER BY ${orderBy}`,
        [ownerId]
      );
      return rows;
    },
    add: async (ownerId, payload) => {
      const cols = [ownerCol], vals = ['?'], params = [ownerId];
      for (const f of fields) {
        if (payload[f] !== undefined) {
          cols.push(f); vals.push('?'); params.push(payload[f] === '' ? null : payload[f]);
        }
      }
      const [r] = await pool.execute(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${vals.join(', ')})`,
        params
      );
      return r.insertId;
    },
    update: async (id, payload) => {
      const sets = [], params = [];
      for (const f of fields) {
        if (payload[f] !== undefined) {
          sets.push(`${f} = ?`); params.push(payload[f] === '' ? null : payload[f]);
        }
      }
      if (!sets.length) return;
      params.push(id);
      await pool.execute(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`, params);
    },
    remove: async (id) => {
      await pool.execute(`DELETE FROM ${table} WHERE id = ?`, [id]);
    },
  };
}

export const educationsCrud = makeCrud(
  'bid_employee_educations',
  ['degree','school','major','graduated_at','thesis','sort_order'],
);
export const careersCrud = makeCrud(
  'bid_employee_careers',
  ['org_name','start_date','end_date','position','duty','sort_order'],
);
export const certificationsCrud = makeCrud(
  'bid_employee_certifications',
  ['name','acquired_at','issuer','cert_number','sort_order'],
);

// ─── 유사사업 마스터 ───
const PROJECT_FIELDS = ['name','agency','start_date','end_date','contract_amount','actual_amount','description'];

export async function listProjects() {
  const [rows] = await pool.query(
    `SELECT id, ${PROJECT_FIELDS.join(', ')}, created_at, updated_at
     FROM bid_projects ORDER BY COALESCE(start_date, '0000-00-00') DESC, id DESC`
  );
  return rows;
}

export async function addProject(payload) {
  if (!payload.name) throw new Error('name 필수');
  const cols = [], vals = [], params = [];
  for (const f of PROJECT_FIELDS) {
    if (payload[f] !== undefined) {
      cols.push(f); vals.push('?'); params.push(payload[f] === '' ? null : payload[f]);
    }
  }
  const [r] = await pool.execute(
    `INSERT INTO bid_projects (${cols.join(', ')}) VALUES (${vals.join(', ')})
     ON DUPLICATE KEY UPDATE
       start_date = COALESCE(VALUES(start_date), start_date),
       end_date   = COALESCE(VALUES(end_date), end_date),
       contract_amount = COALESCE(VALUES(contract_amount), contract_amount),
       actual_amount   = COALESCE(VALUES(actual_amount), actual_amount),
       description = COALESCE(VALUES(description), description),
       id = LAST_INSERT_ID(id)`,
    params
  );
  return r.insertId;
}

export async function updateProject(id, payload) {
  const sets = [], params = [];
  for (const f of PROJECT_FIELDS) {
    if (payload[f] !== undefined) {
      sets.push(`${f} = ?`); params.push(payload[f] === '' ? null : payload[f]);
    }
  }
  if (!sets.length) return;
  params.push(id);
  await pool.execute(`UPDATE bid_projects SET ${sets.join(', ')} WHERE id = ?`, params);
}

export async function deleteProject(id) {
  await pool.execute(`DELETE FROM bid_projects WHERE id = ?`, [id]);
}

// ─── 직원 ↔ 유사사업 join ───
export async function listEmployeeProjects(employeeId) {
  const [rows] = await pool.query(
    `SELECT
       ep.id, ep.employee_id, ep.project_id, ep.role, ep.company_at_time, ep.participation_rate,
       p.name AS project_name, p.agency, p.start_date, p.end_date,
       p.contract_amount, p.actual_amount, p.description,
       ep.created_at, ep.updated_at
     FROM bid_employee_projects ep
     JOIN bid_projects p ON p.id = ep.project_id
     WHERE ep.employee_id = ?
     ORDER BY COALESCE(p.start_date, '0000-00-00') DESC, ep.id DESC`,
    [employeeId]
  );
  return rows;
}

export async function listProjectEmployees(projectId) {
  const [rows] = await pool.query(
    `SELECT
       ep.id, ep.employee_id, ep.role, ep.company_at_time, ep.participation_rate,
       e.name, e.position
     FROM bid_employee_projects ep
     JOIN bid_employees e ON e.id = ep.employee_id
     WHERE ep.project_id = ?
     ORDER BY e.name`,
    [projectId]
  );
  return rows;
}

export async function addEmployeeProject(employeeId, payload) {
  const { project_id, role = null, company_at_time = null, participation_rate = null } = payload || {};
  if (!project_id) throw new Error('project_id 필수');
  const [r] = await pool.execute(
    `INSERT INTO bid_employee_projects
       (employee_id, project_id, role, company_at_time, participation_rate)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       role = VALUES(role),
       company_at_time = VALUES(company_at_time),
       participation_rate = VALUES(participation_rate),
       id = LAST_INSERT_ID(id)`,
    [employeeId, project_id, role || null, company_at_time || null,
     participation_rate === '' || participation_rate == null ? null : participation_rate]
  );
  return r.insertId;
}

export async function updateEmployeeProject(id, payload) {
  const sets = [], params = [];
  for (const f of ['role','company_at_time','participation_rate']) {
    if (payload[f] !== undefined) {
      sets.push(`${f} = ?`);
      params.push(payload[f] === '' ? null : payload[f]);
    }
  }
  if (!sets.length) return;
  params.push(id);
  await pool.execute(`UPDATE bid_employee_projects SET ${sets.join(', ')} WHERE id = ?`, params);
}

export async function removeEmployeeProject(id) {
  await pool.execute(`DELETE FROM bid_employee_projects WHERE id = ?`, [id]);
}
