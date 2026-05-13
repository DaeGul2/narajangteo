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
});

export default pool;

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
