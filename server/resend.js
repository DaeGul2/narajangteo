#!/usr/bin/env node
// DB 에 저장된 공고를 재발송 (크롤링·GPT 호출 없음)
//
//   node resend.js --since=2026-08-26            # created_at ≥ since 인 공고 전부
//   node resend.js --since=2026-08-26 --unsent    # 그중 email_sent_at 이 NULL 인 것만
//   node resend.js --since=2026-08-26 --dry       # 발송 없이 대상만 출력
//   node resend.js --since=... --to=me@insabr.kr  # 수신자 지정 (활성 수신자 대신)
//
// 첨부: report-<date>.md + 채용대행 공고의 디스크 보관 파일 ZIP (server/data/files/<bidNo>/)

import 'dotenv/config';
import archiver from 'archiver';
import { Writable } from 'node:stream';
import pool, { getActiveRecipients, markNoticesEmailSent } from './lib/db.js';
import { buildReportMarkdown, markdownToHtml } from './lib/report.js';
import { sendReport } from './lib/email.js';
import { listFiles, readFile } from './lib/fileStore.js';

function arg(name, def) {
  const m = process.argv.find(a => a.startsWith(`--${name}=`));
  return m ? m.split('=')[1] : def;
}
function flag(name) { return process.argv.includes(`--${name}`); }
function safePathPart(s) {
  return String(s || '').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim();
}
function parseJson(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

async function main() {
  const since = arg('since', null);
  if (!since || !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    console.error('사용법: node resend.js --since=YYYY-MM-DD [--unsent] [--dry] [--to=a@b.kr,c@d.kr]');
    process.exit(1);
  }
  const onlyUnsent = flag('unsent');
  const dry = flag('dry');

  const [rows] = await pool.query(
    `SELECT bid_no, name, agency, demander, bgt_amt, prsp_prce, ai_is_agent, ai_reason,
            detail, prev_history, summary_md, email_sent_at, created_at
       FROM notices
      WHERE created_at >= ? ${onlyUnsent ? 'AND email_sent_at IS NULL' : ''}
      ORDER BY created_at ASC`,
    [since]
  );
  if (!rows.length) {
    console.log(`[resend] 대상 없음 (since=${since}${onlyUnsent ? ', unsent' : ''})`);
    return;
  }

  const items = rows.map(r => {
    const detail = parseJson(r.detail) || {};
    return {
      bidNo: r.bid_no,
      name: r.name,
      agency: r.agency,
      demander: r.demander,
      bgtAmt: r.bgt_amt,
      prspPrce: r.prsp_prce,
      aiIsAgent: r.ai_is_agent === 1 ? true : (r.ai_is_agent === 0 ? false : null),
      aiReason: r.ai_reason || '',
      dmstPic: detail.dmstPic,
      prevHistory: parseJson(r.prev_history) || [],
      summary_md: r.summary_md || '',
      _created: r.created_at,
      _sent: r.email_sent_at,
    };
  });

  console.log(`[resend] 대상 ${items.length}건 (since=${since}${onlyUnsent ? ', unsent' : ''})`);
  for (const it of items) {
    const d = it._created instanceof Date ? it._created.toISOString().slice(0, 10) : String(it._created).slice(0, 10);
    console.log(`  - ${d} ${it.aiIsAgent ? '[대행]' : '      '} ${it.bidNo} ${it.name.slice(0, 50)}`);
  }
  if (dry) { console.log('[resend] --dry — 발송 안 함'); return; }

  const md = buildReportMarkdown(items);
  const html = markdownToHtml(md);
  const today = new Date().toISOString().slice(0, 10);
  const agentCount = items.filter(i => i.aiIsAgent).length;
  const subject = `[g2b 채용 리포트] 재발송 ${since}~${today} 누락분 ${items.length}건 (채용대행 ${agentCount}건)`;

  const attachments = [{ filename: `report-${today}.md`, content: Buffer.from(md, 'utf-8') }];
  const allFiles = items.filter(i => i.aiIsAgent === true).flatMap(it => {
    const folder = `${safePathPart(it.bidNo)}_${safePathPart(it.name).slice(0, 60)}`;
    return listFiles(it.bidNo)
      .map(f => ({ name: `${folder}/${safePathPart(f.name)}`, bytes: readFile(it.bidNo, f.name) }))
      .filter(f => f.bytes);
  });
  if (allFiles.length) {
    const zipBuf = await new Promise((resolve, reject) => {
      const chunks = [];
      const sink = new Writable({ write(c, _e, cb) { chunks.push(c); cb(); } });
      sink.on('finish', () => resolve(Buffer.concat(chunks)));
      sink.on('error', reject);
      const ar = archiver('zip', { zlib: { level: 9 } });
      ar.on('error', reject);
      ar.pipe(sink);
      for (const f of allFiles) ar.append(f.bytes, { name: f.name });
      ar.finalize();
    });
    attachments.push({ filename: `files-${today}.zip`, content: zipBuf });
    console.log(`[resend] ZIP 첨부 ${allFiles.length}개 파일`);
  }

  const toArg = arg('to', null);
  const recipients = toArg
    ? toArg.split(',').map(e => ({ email: e.trim(), name: '' })).filter(r => r.email)
    : await getActiveRecipients();
  if (!recipients.length) { console.log('[resend] 수신자 0명 — 발송 안 함'); return; }

  await sendReport({ subject, html, text: md, attachments, to: recipients });
  await markNoticesEmailSent(items.map(i => i.bidNo));
  console.log(`[resend] 발송 완료 → ${recipients.length}명: ${recipients.map(r => r.email).join(', ')}`);
}

main()
  .catch(e => { console.error('[resend] 실패:', e); process.exitCode = 1; })
  .finally(() => pool.end());
