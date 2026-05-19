// 나라장터 채용 크롤러 — Node Express 엔트리
// 1. /api/health
// 2. /api/crawl           — 검색 API + 분류 + 상세 enrich
// 3. /api/refresh-session — 세션 쿠키 재발급
// 4. /api/download-zip    — Playwright 자동화 → 텍스트 추출 → GPT 요약 → ZIP 스트리밍

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import archiver from 'archiver';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { clean, normalizeBidNo, money } from './lib/utils.js';
import { classify } from './lib/classify.js';
import { callSearchApi, enrichWithDetails, getSessionCookies } from './lib/g2bApi.js';
import { automateDownload } from './lib/automate.js';
import { combineTexts } from './lib/textExtract.js';
import { summarize } from './lib/summarize.js';
import { classifyBatch } from './lib/aiClassify.js';
import { requireAuth, loginRoute, checkRoute, logoutRoute } from './lib/auth.js';
import pool, {
  getActiveRecipients, addRecipient, deactivateRecipient, updateRecipient,
  listEmployees, getEmployee, addEmployee, updateEmployee, deleteEmployee,
  educationsCrud, careersCrud, certificationsCrud,
  listProjects, addProject, updateProject, deleteProject,
  listEmployeeProjects, listProjectEmployees,
  addEmployeeProject, updateEmployeeProject, removeEmployeeProject,
  getCronSettings, updateCronSettings,
} from './lib/db.js';
import { listFiles, readFile } from './lib/fileStore.js';
import { renderToSession, getCachedPdf, getCachedSession } from './lib/labRender.js';
import { generateFromTemplate } from './lib/labGenerate.js';
import { openHwp, extractTree } from './lib/labTree.js';
import { extractFields, extractListTables } from './lib/labFieldExtract.js';
import { replicateForEmployee, replicateInOneFile, replicateInOneFileByFields } from './lib/labReplicate.js';
import { createJob, updateJob, getJob, jobStatus } from './lib/labBulkJobs.js';
import { crawlAttendance } from './lib/attendanceCrawler.js';
import {
  getSecret, setSecret,
  listAttendanceSnapshots, getAttendanceSnapshot, deleteAttendanceSnapshot,
  updateAttendanceRecord, getAttendanceReport,
  listHolidays, addHoliday, deleteHoliday, recomputeAllAttendanceJudgments,
} from './lib/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

const app = express();
// 쿠키 기반 세션 위해 credentials true + 정확한 origin
app.use(cors({
  origin: (origin, cb) => cb(null, origin || true),
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));

// ─── /api/health ───
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ─── 인증 (admin 전용) ───
app.post('/api/auth/login', loginRoute);
app.get('/api/auth/check', checkRoute);
app.post('/api/auth/logout', logoutRoute);

// ─── /api/admin/notices — DB 조회 ───
app.get('/api/admin/notices', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 200), 500);
    const filter = req.query.filter || 'all';  // all | agent | other
    let where = '';
    if (filter === 'agent') where = 'WHERE ai_is_agent = 1';
    else if (filter === 'other') where = 'WHERE ai_is_agent = 0 OR ai_is_agent IS NULL';
    const [rows] = await pool.query(
      `SELECT bid_no, name, agency, demander, bgt_amt, status, posted_at,
              ai_is_agent, ai_reason,
              CHAR_LENGTH(summary_md) > 0 AS has_summary,
              JSON_LENGTH(files_meta) AS files_n,
              JSON_LENGTH(prev_history) AS prev_n,
              email_sent_at, created_at
       FROM notices ${where}
       ORDER BY created_at DESC, bid_no DESC
       LIMIT ?`,
      [limit]
    );
    res.json({ items: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── /api/admin/notices/:bidNo — 단건 상세 ───
app.get('/api/admin/notices/:bidNo', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM notices WHERE bid_no = ?`, [req.params.bidNo]
    );
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    const item = rows[0];
    // 디스크에 저장된 실제 파일 리스트 (cron 시 saveFiles 결과)
    item.disk_files = listFiles(req.params.bidNo);
    res.json(item);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── /api/admin/notices/:bidNo/files/:name — 파일 다운로드 ───
app.get('/api/admin/notices/:bidNo/files/:name', requireAuth, (req, res) => {
  const buf = readFile(req.params.bidNo, req.params.name);
  if (!buf) return res.status(404).json({ error: 'file not found' });
  const safeAscii = req.params.name.replace(/[^\x20-\x7e]+/g, '_');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition',
    `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(req.params.name)}`);
  res.send(buf);
});

// ─── /api/admin/recipients — 수신자 CRUD ───
app.get('/api/admin/recipients', requireAuth, async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT id, email, name, active, created_at FROM recipients ORDER BY id`
  );
  res.json({ items: rows });
});
app.post('/api/admin/recipients', requireAuth, async (req, res) => {
  const { email, name } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email 필수' });
  await addRecipient(email, name || null);
  res.json({ ok: true });
});
app.delete('/api/admin/recipients/:email', requireAuth, async (req, res) => {
  await deactivateRecipient(req.params.email);
  res.json({ ok: true });
});
app.patch('/api/admin/recipients/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid id' });
    const { email, name, active } = req.body || {};
    await updateRecipient(id, { email, name, active });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── /api/admin/bid-employees — 입찰 참여 인력 CRUD ───
app.get('/api/admin/bid-employees', requireAuth, async (_req, res) => {
  try {
    const items = await listEmployees(true);
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post('/api/admin/bid-employees', requireAuth, async (req, res) => {
  try {
    const id = await addEmployee(req.body || {});
    res.json({ ok: true, id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.patch('/api/admin/bid-employees/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid id' });
    await updateEmployee(id, req.body || {});
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.delete('/api/admin/bid-employees/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid id' });
    await deleteEmployee(id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 직원 단건 + 모든 부속 정보 한 번에
app.get('/api/admin/bid-employees/:id/full', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid id' });
    const employee = await getEmployee(id);
    if (!employee) return res.status(404).json({ error: 'not found' });
    const [educations, careers, certifications, projects] = await Promise.all([
      educationsCrud.listByOwner(id),
      careersCrud.listByOwner(id),
      certificationsCrud.listByOwner(id),
      listEmployeeProjects(id),
    ]);
    res.json({ employee, educations, careers, certifications, projects });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 학력 / 경력 / 자격증 CRUD (공통 패턴) ───
function mountChildCrud(basePath, childPath, crud) {
  // 목록 (직원별)
  app.get(`/api/admin/bid-employees/:empId/${basePath}`, requireAuth, async (req, res) => {
    try {
      const empId = Number(req.params.empId);
      if (!empId) return res.status(400).json({ error: 'invalid empId' });
      const items = await crud.listByOwner(empId);
      res.json({ items });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  // 추가
  app.post(`/api/admin/bid-employees/:empId/${basePath}`, requireAuth, async (req, res) => {
    try {
      const empId = Number(req.params.empId);
      if (!empId) return res.status(400).json({ error: 'invalid empId' });
      const id = await crud.add(empId, req.body || {});
      res.json({ ok: true, id });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  // 수정
  app.patch(`/api/admin/${childPath}/:id`, requireAuth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: 'invalid id' });
      await crud.update(id, req.body || {});
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  // 삭제
  app.delete(`/api/admin/${childPath}/:id`, requireAuth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: 'invalid id' });
      await crud.remove(id);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
}
mountChildCrud('educations',     'bid-educations',     educationsCrud);
mountChildCrud('careers',        'bid-careers',        careersCrud);
mountChildCrud('certifications', 'bid-certifications', certificationsCrud);

// ─── 유사사업 마스터 CRUD ───
app.get('/api/admin/bid-projects', requireAuth, async (_req, res) => {
  try {
    const items = await listProjects();
    res.json({ items });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/admin/bid-projects/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid id' });
    const [[row]] = await pool.query(
      `SELECT id, name, agency, start_date, end_date, contract_amount, description,
              created_at, updated_at
       FROM bid_projects WHERE id = ?`, [id]
    );
    if (!row) return res.status(404).json({ error: 'not found' });
    const participants = await listProjectEmployees(id);
    res.json({ project: row, participants });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/bid-projects', requireAuth, async (req, res) => {
  try {
    const id = await addProject(req.body || {});
    res.json({ ok: true, id });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.patch('/api/admin/bid-projects/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid id' });
    await updateProject(id, req.body || {});
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/admin/bid-projects/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid id' });
    await deleteProject(id);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─── 직원 ↔ 유사사업 join CRUD ───
app.get('/api/admin/bid-employees/:empId/projects', requireAuth, async (req, res) => {
  try {
    const empId = Number(req.params.empId);
    if (!empId) return res.status(400).json({ error: 'invalid empId' });
    const items = await listEmployeeProjects(empId);
    res.json({ items });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/bid-employees/:empId/projects', requireAuth, async (req, res) => {
  try {
    const empId = Number(req.params.empId);
    if (!empId) return res.status(400).json({ error: 'invalid empId' });
    const id = await addEmployeeProject(empId, req.body || {});
    res.json({ ok: true, id });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
// 프로젝트 컨텍스트에서 참여자 추가 — 직원 페이지 안 들어가도 등록 가능
app.post('/api/admin/bid-projects/:projId/employees', requireAuth, async (req, res) => {
  try {
    const projId = Number(req.params.projId);
    if (!projId) return res.status(400).json({ error: 'invalid projId' });
    const { employee_id, role, company_at_time, participation_rate } = req.body || {};
    if (!employee_id) return res.status(400).json({ error: 'employee_id 필수' });
    const id = await addEmployeeProject(Number(employee_id), {
      project_id: projId, role, company_at_time, participation_rate,
    });
    res.json({ ok: true, id });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.patch('/api/admin/bid-emp-projects/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid id' });
    await updateEmployeeProject(id, req.body || {});
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/admin/bid-emp-projects/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid id' });
    await removeEmployeeProject(id);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─── 실험실 — hwp/hwpx → LibreOffice → PDF → 페이지 미리보기 + GPT 생성 ───
// 업로드 raw binary. 클라이언트가 ?filename=foo.hwp 로 확장자 알려줌
app.post(
  '/api/admin/lab/parse',
  requireAuth,
  express.raw({ type: '*/*', limit: '30mb' }),
  async (req, res) => {
    try {
      const filename = String(req.query.filename || '');
      if (!filename) return res.status(400).json({ error: 'filename 쿼리 필요' });
      if (!req.body || !req.body.length) return res.status(400).json({ error: '본문(파일) 비어 있음' });
      const { sid, pages, pageCount } = await renderToSession(req.body, filename);
      res.json({ filename, sid, pageCount, pages });
    } catch (e) {
      console.error('[lab/parse]', e);
      res.status(500).json({ error: e.message });
    }
  }
);

// PDF 바이너리 — 클라이언트 pdfjs 가 fetch 해서 직접 렌더
app.get('/api/admin/lab/pdf/:sid', requireAuth, (req, res) => {
  const item = getCachedPdf(req.params.sid);
  if (!item) return res.status(404).json({ error: '세션 만료 또는 없음 — 파일을 다시 올려주세요' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Cache-Control', 'private, max-age=900');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(item.filename)}.pdf"`);
  res.end(item.buf);
});

app.post('/api/admin/lab/generate', requireAuth, async (req, res) => {
  try {
    const { template, instruction, scopes } = req.body || {};
    const out = await generateFromTemplate({ template, instruction, scopes });
    res.json({ result: out });
  } catch (e) {
    console.error('[lab/generate]', e);
    res.status(500).json({ error: e.message });
  }
});

// 트리 JSON — 디버그/검증용
app.get('/api/admin/lab/tree/:sid', requireAuth, async (req, res) => {
  try {
    const item = getCachedSession(req.params.sid);
    if (!item) return res.status(404).json({ error: '세션 만료 — 파일을 다시 올려주세요' });
    const doc = await openHwp(item.hwpBuf);
    const tree = await extractTree(doc);
    res.json({ filename: item.filename, tree });
  } catch (e) {
    console.error('[lab/tree]', e);
    res.status(500).json({ error: e.message });
  }
});

// 필드 자동 추출 — 라벨/값 쌍을 찾아서 클라가 X 로 제거하거나 매핑 지정
app.get('/api/admin/lab/fields/:sid', requireAuth, async (req, res) => {
  try {
    const item = getCachedSession(req.params.sid);
    if (!item) return res.status(404).json({ error: '세션 만료 — 파일을 다시 올려주세요' });
    const doc = await openHwp(item.hwpBuf);
    const tree = await extractTree(doc);
    const fields = extractFields(tree);
    const listTables = extractListTables(tree);
    res.json({ filename: item.filename, fields, listTables });
  } catch (e) {
    console.error('[lab/fields]', e);
    res.status(500).json({ error: e.message });
  }
});

// 직원 선택용 리스트
app.get('/api/admin/lab/employees', requireAuth, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, position FROM bid_employees WHERE active = 1 ORDER BY name`
    );
    res.json({ employees: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 배치 시작 — N명을 단일 .hwp 안에 차례로. 즉시 jobId 반환, 백그라운드 처리.
app.post('/api/admin/lab/replicate-bulk', requireAuth, async (req, res) => {
  try {
    const { sid, employeeIds, instruction, mode = 'free', userFields, userListTables } = req.body || {};
    if (!sid) return res.status(400).json({ error: 'sid 필요' });
    if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
      return res.status(400).json({ error: 'employeeIds 비어 있음' });
    }
    if (mode === 'fields' && (!Array.isArray(userFields) || userFields.length === 0)) {
      return res.status(400).json({ error: '필드 모드인데 userFields 가 비어 있음' });
    }
    const item = getCachedSession(sid);
    if (!item) return res.status(404).json({ error: '세션 만료 — 파일을 다시 올려주세요' });

    const jobId = createJob(employeeIds.length);
    res.json({ jobId, total: employeeIds.length, mode });

    (async () => {
      try {
        updateJob(jobId, { phase: 'processing' });
        const onProgress = ({ current, total, currentName, phase, stage }) => {
          updateJob(jobId, {
            current, total, currentName,
            phase: phase || 'processing',
            stage: stage || '',
          });
        };

        let result;
        if (mode === 'fields') {
          result = await replicateInOneFileByFields({
            hwpBuf: item.hwpBuf,
            employeeIds: employeeIds.map(Number),
            userFields,
            userListTables,
            onProgress,
          });
        } else {
          result = await replicateInOneFile({
            hwpBuf: item.hwpBuf,
            employeeIds: employeeIds.map(Number),
            instruction: instruction || '',
            onProgress,
          });
        }
        updateJob(jobId, {
          phase: 'done',
          zipBuf: result.hwpBytes, // 호환 — jobs 스토어가 zipBuf 로 받음. 실제로는 .hwp 바이트
          successNames: result.successNames,
          failed: result.failed,
          currentName: '',
          templateName: item.filename,
        });
      } catch (e) {
        console.error('[lab/replicate-bulk worker]', e);
        updateJob(jobId, { phase: 'error', error: e.message });
      }
    })();
  } catch (e) {
    console.error('[lab/replicate-bulk]', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/lab/replicate-bulk/:jobId', requireAuth, (req, res) => {
  const s = jobStatus(req.params.jobId);
  if (!s) return res.status(404).json({ error: 'job 없음 또는 만료' });
  res.json(s);
});

app.get('/api/admin/lab/replicate-bulk/:jobId/download', requireAuth, (req, res) => {
  const j = getJob(req.params.jobId);
  if (!j) return res.status(404).json({ error: 'job 없음 또는 만료' });
  if (j.phase !== 'done') return res.status(409).json({ error: `아직 끝나지 않음 (phase=${j.phase})` });
  if (!j.zipBuf || j.zipBuf.length === 0) return res.status(404).json({ error: '생성된 파일 없음 (모두 실패)' });

  const base = (j.templateName || 'template').replace(/\.(hwp|hwpx)$/i, '');
  const stamp = new Date().toISOString().slice(0, 10);
  const outName = `${base}_복제_${stamp}.hwp`;
  res.setHeader('Content-Type', 'application/x-hwp');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(outName)}"`);
  res.end(j.zipBuf);
});

// 한 명용 .hwp 생성 + 다운로드
app.post('/api/admin/lab/replicate', requireAuth, async (req, res) => {
  try {
    const { sid, employeeId, instruction } = req.body || {};
    if (!sid) return res.status(400).json({ error: 'sid 필요' });
    if (!employeeId) return res.status(400).json({ error: 'employeeId 필요' });
    const item = getCachedSession(sid);
    if (!item) return res.status(404).json({ error: '세션 만료 — 파일을 다시 올려주세요' });

    const { hwpBytes, summary } = await replicateForEmployee({
      hwpBuf: item.hwpBuf,
      employeeId: Number(employeeId),
      instruction: instruction || '',
    });

    const base = (item.filename || 'template').replace(/\.(hwp|hwpx)$/i, '');
    const outName = `${base}_${summary.employeeName || employeeId}.hwp`;
    res.setHeader('Content-Type', 'application/x-hwp');
    res.setHeader('X-Replicate-Summary', encodeURIComponent(JSON.stringify(summary)));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(outName)}"`
    );
    res.end(hwpBytes);
  } catch (e) {
    console.error('[lab/replicate]', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── /api/admin/cron-settings — 일일 자동 실행 시간 관리 ───
app.get('/api/admin/cron-settings', requireAuth, async (_req, res) => {
  try {
    const s = await getCronSettings();
    res.json({ ...s, next_run_at: computeNextRun(s) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.patch('/api/admin/cron-settings', requireAuth, async (req, res) => {
  try {
    await updateCronSettings(req.body || {});
    const s = await getCronSettings();
    res.json({ ok: true, settings: { ...s, next_run_at: computeNextRun(s) } });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
// ─── 출퇴근 관리 — 메일플러그 크롤 ───
// mode='cookie' : DB의 mailplug_cookies 주입해서 출퇴근 페이지 접근. (권장)
// mode='auto'   : 영구 프로파일 + 세션 살아있어야 함 (deprecated)
// mode='setup'  : 빈 크롬 띄움 (deprecated, Cloudflare 차단 가능성 큼)
app.post('/api/admin/attendance/crawl', requireAuth, async (req, res) => {
  try {
    const { mode = 'cookie' } = req.body || {};
    const result = await crawlAttendance({ mode });
    res.json(result);
  } catch (e) {
    console.error('[attendance/crawl]', e);
    res.status(500).json({ error: e.message });
  }
});

// 쿠키 저장 — 사용자가 본인 Chrome 에서 복사한 Cookie 헤더 문자열
app.post('/api/admin/attendance/cookies', requireAuth, async (req, res) => {
  try {
    const { cookie, note } = req.body || {};
    if (!cookie || typeof cookie !== 'string' || cookie.length < 10) {
      return res.status(400).json({ error: '쿠키 문자열이 비어있거나 너무 짧음' });
    }
    await setSecret('mailplug_cookies', cookie.trim(), note || null);
    res.json({ ok: true });
  } catch (e) {
    console.error('[attendance/cookies POST]', e);
    res.status(500).json({ error: e.message });
  }
});

// 출퇴근 스냅샷 — 목록
app.get('/api/admin/attendance/snapshots', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const items = await listAttendanceSnapshots(limit);
    res.json({ items });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// 단건 — 메타 + 12컬럼 row 전체
app.get('/api/admin/attendance/snapshots/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid id' });
    const data = await getAttendanceSnapshot(id);
    if (!data) return res.status(404).json({ error: '없음' });
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/admin/attendance/snapshots/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid id' });
    await deleteAttendanceSnapshot(id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 공휴일 캘린더 — CRUD
app.get('/api/admin/holidays', requireAuth, async (_req, res) => {
  try { res.json({ items: await listHolidays() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/holidays', requireAuth, async (req, res) => {
  try {
    const { date, name } = req.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).json({ error: 'date 형식 (YYYY-MM-DD)' });
    if (!name) return res.status(400).json({ error: 'name 필요' });
    await addHoliday(date, name, 'manual');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/admin/holidays/:date', requireAuth, async (req, res) => {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) return res.status(400).json({ error: 'date 형식' });
    await deleteHoliday(req.params.date);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// 공휴일 변경 후 일괄 재평가 (manual_override=0 만)
app.post('/api/admin/attendance/recompute', requireAuth, async (_req, res) => {
  try { res.json(await recomputeAllAttendanceJudgments()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// 기간별 출퇴근 리포트
app.get('/api/admin/attendance/report', requireAuth, async (req, res) => {
  try {
    const { from, to } = req.query || {};
    if (!from || !to) return res.status(400).json({ error: 'from / to (YYYY-MM-DD) 필수' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ error: '날짜 형식 오류' });
    }
    const data = await getAttendanceReport(from, to);
    res.json(data);
  } catch (e) {
    console.error('[attendance/report]', e);
    res.status(500).json({ error: e.message });
  }
});

// 지각 판정 수정 — { is_late?: 0|1|null, manual_note?: string, reset?: true }
app.patch('/api/admin/attendance/records/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid id' });
    const { is_late, manual_note, reset } = req.body || {};
    const patch = {};
    if (reset) patch.reset = true;
    else {
      if (is_late !== undefined) {
        if (is_late !== null && is_late !== 0 && is_late !== 1) {
          return res.status(400).json({ error: 'is_late 은 0 / 1 / null 만 가능' });
        }
        patch.is_late = is_late;
      }
      if (manual_note !== undefined) patch.manual_note = manual_note;
    }
    const result = await updateAttendanceRecord(id, patch);
    if (!result) return res.status(404).json({ error: 'record not found' });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 쿠키 등록 상태 (값은 노출 X)
app.get('/api/admin/attendance/cookies', requireAuth, async (_req, res) => {
  try {
    const s = await getSecret('mailplug_cookies');
    if (!s) return res.json({ registered: false });
    res.json({
      registered: true,
      length: s.v.length,
      updated_at: s.updated_at,
      last_used_at: s.last_used_at,
      note: s.note,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/cron-settings/run-now', requireAuth, async (_req, res) => {
  try {
    const s = await getCronSettings();
    fireCronChild(s.days_back, 'manual');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── /api/admin/stats — 요약 통계 ───
app.get('/api/admin/stats', requireAuth, async (_req, res) => {
  const [[n]]   = await pool.query(`SELECT COUNT(*) AS c FROM notices`);
  const [[ag]]  = await pool.query(`SELECT COUNT(*) AS c FROM notices WHERE ai_is_agent = 1`);
  const [[ot]]  = await pool.query(`SELECT COUNT(*) AS c FROM notices WHERE ai_is_agent = 0`);
  const [[lr]]  = await pool.query(
    `SELECT id, started_at, finished_at, status, total_found, new_count, email_sent
     FROM cron_runs ORDER BY id DESC LIMIT 1`
  );
  const [[rc]]  = await pool.query(`SELECT COUNT(*) AS c FROM recipients WHERE active = 1`);
  res.json({
    notices_total: n.c,
    notices_agent: ag.c,
    notices_other: ot.c,
    recipients_active: rc.c,
    last_run: lr || null,
  });
});

// ─── /api/refresh-session ───
app.post('/api/refresh-session', async (_req, res) => {
  await getSessionCookies(true);
  res.json({ ok: true });
});

// ─── /api/crawl ───
app.post('/api/crawl', async (_req, res) => {
  try {
    const rows = await callSearchApi('채용', 100, 30);
    const items = [];
    rows.forEach((r, idx) => {
      if (!r || typeof r !== 'object') return;
      const name = clean(r.bidPbancNm || r.BidPbancNm || r.bidPbancNmCnts);
      if (!name) return;
      const { isRecruitment, reason } = classify(name);
      items.push({
        no: String(idx + 1),
        name,
        bidNo: normalizeBidNo(r.bidPbancUntyNoOrd || r.bidPbancNo || r.untyBidPbancNo),
        agency: clean(r.oderInstUntyGrpNm || r.instNm || r.ntceInsttNm),
        demander: clean(r.dmstNm || r.dminsttNm),
        date: clean(r.pbancPstgDt || r.bidNtceDt || r.ntceDate),
        deadline: clean(r.bidPbancLastRcptYmd || r.bidClseDt),
        status: clean(r.pbancSttsNm || r.bidNtceSttusNm),
        category: clean(r.prcmBsneSeCdNm || r.bsneClsfCdNm),
        bgtAmt: money(r.alotBgtAmt),
        prspPrce: money(r.prspPrce),
        scsbdMthd: clean(r.scsbdMthdNm),
        pnprMtho: clean(r.pnprDcsnMthoNm),
        _bidPbancUntyNo: clean(r.bidPbancUntyNo),
        _bidPbancUntyOrd: clean(r.bidPbancUntyOrd),
        _bidPbancNo: clean(r.bidPbancNo || r.bidPbancUntyNoOrd),
        isRecruitment,
        reason,
      });
    });

    console.log(`[detail] ${items.length}건 디테일 API 호출`);
    try {
      await enrichWithDetails(items, 8);
      console.log('[detail] 완료');
    } catch (e) {
      console.log(`[detail] 실패: ${e.message} (디테일 없이 진행)`);
    }

    // GPT 정밀 분류 (캐시 활용)
    console.log(`[ai] GPT 채용대행 분류 ${items.length}건`);
    try {
      const aiInput = items.map((it, i) => ({ id: String(i), name: it.name }));
      const aiMap = await classifyBatch(aiInput);
      for (let i = 0; i < items.length; i++) {
        const r = aiMap.get(String(i));
        if (r) {
          items[i].aiIsAgent = r.isAgent;
          items[i].aiReason = r.reason;
        } else {
          items[i].aiIsAgent = null;  // GPT 실패 시 null
          items[i].aiReason = '';
        }
      }
      console.log(`[ai] 완료 (true: ${items.filter(i => i.aiIsAgent === true).length}, false: ${items.filter(i => i.aiIsAgent === false).length}, null: ${items.filter(i => i.aiIsAgent === null).length})`);
    } catch (e) {
      console.log(`[ai] 실패: ${e.message}`);
    }

    // AI 판단을 우선, GPT 실패 시 정규식 fallback
    const isAgentFinal = (it) => it.aiIsAgent !== null && it.aiIsAgent !== undefined
      ? it.aiIsAgent
      : it.isRecruitment;

    const recruitment = items.filter(isAgentFinal);
    const other = items.filter(i => !isAgentFinal(i));
    res.json({
      total: items.length,
      recruitmentCount: recruitment.length,
      otherCount: other.length,
      recruitment, other,
    });
  } catch (e) {
    console.error('[crawl] 실패:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── /api/download-zip ───
app.post('/api/download-zip', async (req, res) => {
  const { bidNo = '', name = '', files = [] } = req.body || {};
  console.log(`[zip] 시작: ${bidNo} ${name}`);
  let downloaded = [];
  let diagLog = [];
  let err = null;
  try {
    const r = await automateDownload(bidNo, name);
    downloaded = r.files;
    diagLog = r.log;
  } catch (e) {
    err = `${e.name || 'Error'}: ${e.message}`;
    console.log(`[zip] 자동화 실패: ${err}`);
  }

  // 텍스트 추출 + GPT 요약
  let summaryMd = '';
  if (downloaded.length) {
    const combined = await combineTexts(downloaded);
    console.log(`[zip] 추출 텍스트 ${combined.length}자`);
    if (combined) {
      summaryMd = await summarize(combined, bidNo, name);
      console.log(`[zip] GPT 요약 ${summaryMd.length}자`);
    }
  }

  // ZIP 응답 헤더
  const safeAscii = (name || bidNo || 'files').replace(/[^\x20-\x7e]+/g, '_').slice(0, 60);
  const utf8Name = encodeURIComponent(`${bidNo || 'g2b'}_${name || 'files'}.zip`);
  let summaryB64 = '';
  if (summaryMd) {
    summaryB64 = Buffer.from(summaryMd.slice(0, 3000), 'utf-8').toString('base64');
  }
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition',
    `attachment; filename="${bidNo || 'g2b'}_${safeAscii}.zip"; filename*=UTF-8''${utf8Name}`);
  res.setHeader('X-File-Count', String(downloaded.length));
  res.setHeader('X-Summary-B64', summaryB64);
  res.setHeader('Access-Control-Expose-Headers', 'X-File-Count, X-Summary-B64');

  const safePart = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim();
  const folder = `${safePart(bidNo) || 'g2b'}_${safePart(name).slice(0, 60)}`;

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (e) => { console.error('[zip] archive err:', e); });
  archive.pipe(res);
  for (const f of downloaded) {
    try {
      archive.append(f.bytes, { name: `${folder}/${safePart(f.name)}` });
    } catch (e) {
      diagLog.push(`zip append 실패 ${f.name}: ${e.message}`);
    }
  }
  if (summaryMd) {
    archive.append(Buffer.from(summaryMd, 'utf-8'), { name: `${folder}/_summary.md` });
  }
  if (!downloaded.length) {
    const txt =
      `[자동 다운로드 실패]\n\n공고번호: ${bidNo}\n공고명: ${name}\n` +
      `에러: ${err || '(파일 0개)'}\n\n--- diag ---\n` + diagLog.join('\n');
    archive.append(Buffer.from(txt, 'utf-8'), { name: `${folder}/_FAILED.txt` });
  }
  await archive.finalize();
  console.log(`[zip] 종료: ${downloaded.length}개 파일, 요약 ${summaryMd.length}자`);
});

// ─── 인프로세스 cron 스케줄러 (1분 tick, KST 기준) ───
// DB cron_settings 테이블의 hour/minute/enabled/days_back 을 매 tick 마다 읽어 적용한다.
// 같은 KST 일자에 한 번만 발화 (lastFiredKstDate 메모리 가드 + 부팅 시 cron_runs 조회로 재수화).
const KST_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', hour12: false,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit',
});
function getKstParts(date = new Date()) {
  const obj = {};
  for (const p of KST_FMT.formatToParts(date)) obj[p.type] = p.value;
  return {
    dateKey: `${obj.year}-${obj.month}-${obj.day}`,
    hour: Number(obj.hour),
    minute: Number(obj.minute),
  };
}

function computeNextRun(s) {
  if (!s || !s.enabled) return null;
  const now = new Date();
  const nowKst = getKstParts(now);
  // 오늘 KST 시각의 분(minute)을 기준으로 next 계산
  const nowMinTotal = nowKst.hour * 60 + nowKst.minute;
  const tgtMinTotal = s.hour * 60 + s.minute;
  const dayOffset = nowMinTotal < tgtMinTotal ? 0 : 1;
  // KST 기준 next 일자 계산
  const [y, m, d] = nowKst.dateKey.split('-').map(Number);
  // KST = UTC+9. 우리는 KST 시각으로 표현된 Date 를 만든다.
  const kstNext = new Date(Date.UTC(y, m - 1, d + dayOffset, s.hour - 9, s.minute, 0));
  return kstNext.toISOString();
}

let lastFiredKstDate = null;   // 'YYYY-MM-DD' (KST)
let cronChildRunning = false;

function fireCronChild(daysBack, source = 'schedule') {
  if (cronChildRunning) {
    console.log(`[cron-scheduler] (${source}) 이미 실행 중 — 스킵`);
    return;
  }
  cronChildRunning = true;
  console.log(`[cron-scheduler] (${source}) cron.js --days=${daysBack} 시작`);
  const cp = spawn(process.execPath, ['cron.js', `--days=${daysBack}`], {
    cwd: __dirname,
    stdio: 'inherit',
    env: process.env,
  });
  cp.on('exit', (code) => {
    cronChildRunning = false;
    console.log(`[cron-scheduler] cron.js 종료 (code=${code})`);
  });
  cp.on('error', (e) => {
    cronChildRunning = false;
    console.error(`[cron-scheduler] spawn 실패:`, e);
  });
}

async function rehydrateLastFired() {
  // 부팅 시 — 오늘(KST)에 이미 cron 이 시작된 적이 있으면 재발화 방지.
  // dateStrings:true 라 started_at 은 'YYYY-MM-DD HH:MM:SS' 문자열, 커넥션 timezone +09:00.
  try {
    const todayKst = getKstParts().dateKey;
    const [[r]] = await pool.query(
      `SELECT started_at FROM cron_runs
       WHERE started_at >= ? ORDER BY id DESC LIMIT 1`,
      [`${todayKst} 00:00:00`]
    );
    if (r) {
      lastFiredKstDate = todayKst;
      console.log(`[cron-scheduler] 오늘(${todayKst}) 이미 실행 기록 존재 — 재발화 방지`);
    }
  } catch (e) {
    console.error('[cron-scheduler] rehydrate 실패:', e.message);
  }
}

async function tick() {
  try {
    const s = await getCronSettings();
    if (!s.enabled) return;
    const { dateKey, hour, minute } = getKstParts();
    if (lastFiredKstDate === dateKey) return;
    if (hour === s.hour && minute === s.minute) {
      lastFiredKstDate = dateKey;
      fireCronChild(s.days_back, 'schedule');
    }
  } catch (e) {
    console.error('[cron-scheduler] tick 실패:', e.message);
  }
}

app.listen(PORT, '127.0.0.1', async () => {
  console.log(`[server] http://127.0.0.1:${PORT}  (model=${process.env.OPENAI_MODEL || 'gpt-4.1-mini'}, key=${process.env.OPENAI_API_KEY ? '설정됨' : '미설정'})`);
  await rehydrateLastFired();
  try {
    const s = await getCronSettings();
    console.log(`[cron-scheduler] 활성=${!!s.enabled}, ${String(s.hour).padStart(2,'0')}:${String(s.minute).padStart(2,'0')} KST, days_back=${s.days_back}`);
  } catch (e) {
    console.error('[cron-scheduler] 부팅 시 설정 조회 실패:', e.message);
  }
  setInterval(tick, 60_000);
});
