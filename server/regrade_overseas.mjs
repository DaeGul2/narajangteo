#!/usr/bin/env node
// 해외공고 재판별 — 저장된 공고의 grade/type/topic 을 다시 매긴다 (메일 X)
//   node regrade_overseas.mjs --null                 # grade 가 비어 있는 것만 (v3 데이터 백필)
//   node regrade_overseas.mjs --since="2026-09-16 10:00:00" [--source=suhyup,koipa]
//   --force : GPT 캐시 무시
//   --reset-mail : 대상 중 오늘 메일 나간 것의 email_sent_at 을 NULL 로 (재발송 준비)
import 'dotenv/config';
import pool, { updateOverseasNoticeAnalysis } from './lib/db.js';
import { classifyOverseas } from './lib/overseasClassify.js';
import { classifyInput } from './cron_overseas.js';

const arg = (n, d) => { const m = process.argv.find(a => a.startsWith(`--${n}=`)); return m ? m.split('=').slice(1).join('=') : d; };
const FORCE = process.argv.includes('--force');
const ONLY_NULL = process.argv.includes('--null');
const RESET_MAIL = process.argv.includes('--reset-mail');
const SINCE = arg('since', null);
const SOURCES = (arg('source', '') || '').split(',').map(s => s.trim()).filter(Boolean);

const where = [], params = [];
if (ONLY_NULL) where.push('grade IS NULL');
if (SINCE) { where.push('created_at >= ?'); params.push(SINCE); }
if (SOURCES.length) { where.push('source IN (?)'); params.push(SOURCES); }
if (!where.length) { console.error('조건 필요: --null / --since= / --source='); process.exit(1); }

const [rows] = await pool.query(`SELECT id, source, notice_key, title, organization, grade, email_sent_at FROM overseas_notices WHERE ${where.join(' AND ')} ORDER BY id`, params);
console.log(`[regrade] 대상 ${rows.length}건 (${where.join(' AND ')})`);
const cls = await classifyOverseas(rows.map((r, i) => ({ id: String(i), ...classifyInput({ source: r.source, title: r.title, organization: r.organization }) })), { force: FORCE });
const cnt = {}; const changed = [];
for (let i = 0; i < rows.length; i++) {
  const r = rows[i], v = cls.get(String(i));
  if (!v || !v.grade) continue;
  cnt[v.grade] = (cnt[v.grade] || 0) + 1;
  if (r.grade !== v.grade) changed.push(`${r.source} ${r.grade || '-'}→${v.grade} | ${r.title.slice(0, 50)}`);
  await updateOverseasNoticeAnalysis(r.source, r.notice_key, { grade: v.grade, noticeType: v.type, topic: v.topic, aiReason: v.reason });
}
console.log('[regrade] 결과:', JSON.stringify(cnt));
if (changed.length) { console.log(`[regrade] 등급 변경 ${changed.length}건:`); for (const c of changed) console.log('  ', c); }
if (RESET_MAIL) {
  const [r] = await pool.query(`UPDATE overseas_notices SET email_sent_at = NULL WHERE id IN (?) AND email_sent_at IS NOT NULL`, [rows.map(x => x.id)]);
  console.log(`[regrade] email_sent_at 초기화 ${r.affectedRows}건`);
}
await pool.end();
