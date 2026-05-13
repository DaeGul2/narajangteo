// 나라장터 채용 크롤러 — Node Express 엔트리
// 1. /api/health
// 2. /api/crawl           — 검색 API + 분류 + 상세 enrich
// 3. /api/refresh-session — 세션 쿠키 재발급
// 4. /api/download-zip    — Playwright 자동화 → 텍스트 추출 → GPT 요약 → ZIP 스트리밍

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import archiver from 'archiver';
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
} from './lib/db.js';
import { listFiles, readFile } from './lib/fileStore.js';

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

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[server] http://127.0.0.1:${PORT}  (model=${process.env.OPENAI_MODEL || 'gpt-4.1-mini'}, key=${process.env.OPENAI_API_KEY ? '설정됨' : '미설정'})`);
});
