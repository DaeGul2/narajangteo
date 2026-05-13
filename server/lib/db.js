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

// ─── 입찰 참여 인력 ───
const EMP_FIELDS = [
  'name','name_en','phone','email','birth_date','position','final_edu','school','major',
  'tech_grade','grad_year','grad_month','external_join_date','real_join_date','active',
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
const PROJECT_FIELDS = ['name','agency','start_date','end_date','contract_amount','description'];

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
       p.contract_amount, p.description,
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
