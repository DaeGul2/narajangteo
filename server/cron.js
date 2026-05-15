#!/usr/bin/env node
// 일일 자동 크롤러
// 1) 검색 API + 디테일 enrich + 이전 채용대행 기록
// 2) DB 조회 → 신규 bidNo 만 추림
// 3) 신규 각 건 풀 파이프라인 (자동 다운로드 → 텍스트 추출 → GPT 요약)
// 4) GPT 분류
// 5) DB INSERT
// 6) 마크다운 리포트 + HTML → SES 이메일 발송
//
// 사용:
//   node cron.js          # 기본: 검색 100건 days_back=30
//   node cron.js --days=7 # 최근 7일만

import 'dotenv/config';
import { clean, normalizeBidNo, money } from './lib/utils.js';
import { classify } from './lib/classify.js';
import { callSearchApi, enrichWithDetails } from './lib/g2bApi.js';
import { automateDownload } from './lib/automate.js';
import { combineTexts } from './lib/textExtract.js';
import { summarize } from './lib/summarize.js';
import { classifyBatch } from './lib/aiClassify.js';
import { buildReportMarkdown, markdownToHtml } from './lib/report.js';
import { sendReport } from './lib/email.js';
import { existsBidNos, insertNotice, startCronRun, finishCronRun, getActiveRecipients, getCronSettings } from './lib/db.js';
import { saveFiles } from './lib/fileStore.js';
import archiver from 'archiver';
import { Writable } from 'node:stream';

function arg(name, def) {
  const m = process.argv.find(a => a.startsWith(`--${name}=`));
  return m ? m.split('=')[1] : def;
}

// 파일/폴더 이름 안전화 (모든 OS 호환)
function safePathPart(s) {
  return String(s || '')
    .replace(/[\\/:*?"<>|]+/g, '_')   // 윈도우 금지문자
    .replace(/\s+/g, ' ')
    .trim();
}

async function buildItemsFromSearch(daysBack) {
  const rows = await callSearchApi('채용', 100, daysBack);
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
      bgtAmt: money(r.alotBgtAmt),
      prspPrce: money(r.prspPrce),
      scsbdMthd: clean(r.scsbdMthdNm),
      pnprMtho: clean(r.pnprDcsnMthoNm),
      _bidPbancNo: clean(r.bidPbancNo || r.bidPbancUntyNoOrd),
      isRecruitment,
      reason,
    });
  });
  return items;
}

async function pipelinePerNotice(it) {
  console.log(`  ▶ ${it.bidNo} ${it.name.slice(0, 40)}...`);
  let downloaded = [];
  let summaryMd = '';
  let filesMeta = [];
  try {
    const r = await automateDownload(it.bidNo, it.name);
    downloaded = r.files;
    // 디스크에 영구 보존 (admin 페이지 재다운로드용)
    filesMeta = saveFiles(it.bidNo, downloaded);
    if (downloaded.length) {
      const combined = await combineTexts(downloaded);
      if (combined) {
        summaryMd = await summarize(combined, it.bidNo, it.name);
      }
    }
  } catch (e) {
    console.log(`    ⚠ 자동화 실패: ${e.message}`);
  }
  it.summary_md = summaryMd;
  it.files_meta = filesMeta;
  it._downloaded = downloaded;  // 첨부 ZIP 만들 때 사용 (이메일 첨부용 옵션)
  return it;
}

async function main() {
  // --days 명시 시 우선, 아니면 DB cron_settings.days_back, 그래도 없으면 5
  let daysBack;
  const argDays = arg('days', null);
  if (argDays != null) {
    daysBack = Number(argDays);
  } else {
    try {
      const s = await getCronSettings();
      daysBack = Number(s.days_back) || 5;
    } catch (e) {
      console.log(`[cron] cron_settings 조회 실패 — 기본 5일 사용 (${e.message})`);
      daysBack = 5;
    }
  }
  const cronId = await startCronRun();
  let status = 'failed';
  let totalFound = 0;
  let newCount = 0;
  let emailSent = false;
  let errorMsg = null;

  try {
    console.log(`[cron] 시작 (daysBack=${daysBack})`);

    // 1) 검색 (무료, 메타만)
    const items = await buildItemsFromSearch(daysBack);
    totalFound = items.length;
    console.log(`[cron] 검색 ${items.length}건`);

    // 2) DB 조회 → 신규만 추림 (GPT 호출 전에 — 비용 절감)
    const allBids = items.map(i => i.bidNo).filter(Boolean);
    const existed = await existsBidNos(allBids);
    const newItems = items.filter(i => i.bidNo && !existed.has(i.bidNo));
    newCount = newItems.length;
    console.log(`[cron] 신규: ${newCount}건 (기존 ${existed.size}건 제외)`);

    if (newCount === 0) {
      console.log('[cron] 신규 없음 — 메일 발송 안 함');
      status = 'success';
      return;
    }

    // 3) 신규만 디테일 enrich (디테일 API + 이전 채용대행 기록 매칭)
    await enrichWithDetails(newItems, 8);
    console.log('[cron] 신규 디테일 enrich 완료');

    // 4) 신규만 GPT 분류 (유료 — 캐시 활용)
    const aiIn = newItems.map((it, i) => ({ id: String(i), name: it.name }));
    const aiMap = await classifyBatch(aiIn);
    for (let i = 0; i < newItems.length; i++) {
      const r = aiMap.get(String(i));
      newItems[i].aiIsAgent = r ? r.isAgent : (newItems[i].isRecruitment ? true : false);
      newItems[i].aiReason = r?.reason || '';
    }
    console.log(`[cron] 신규 GPT 분류 완료 (채용대행: ${newItems.filter(i => i.aiIsAgent).length})`);

    // 5) 신규 풀 파이프라인 (다운로드 + 텍스트 + GPT 요약, 유료)
    console.log('[cron] 신규 풀 파이프라인 시작...');
    for (const it of newItems) {
      await pipelinePerNotice(it);
    }

    // 6) DB 저장
    for (const it of newItems) {
      await insertNotice({
        bid_no: it.bidNo,
        name: it.name,
        agency: it.agency,
        demander: it.demander,
        bgt_amt: it.bgtAmt,
        prsp_prce: it.prspPrce,
        scsbd_mthd: it.scsbdMthd,
        pnpr_mtho: it.pnprMtho,
        pbanc_knd: it.pbancKnd,
        status: it.status,
        posted_at: it.date,
        deadline: it.deadline,
        ai_is_agent: it.aiIsAgent ? 1 : (it.aiIsAgent === false ? 0 : null),
        ai_reason: it.aiReason,
        detail: { progress: it.progress, dmstPic: it.dmstPic, files: it.files, untyAtchFileNo: it.untyAtchFileNo },
        prev_history: it.prevHistory || [],
        summary_md: it.summary_md,
        files_meta: it.files_meta,
        email_sent_at: new Date(),
      });
    }
    console.log(`[cron] DB INSERT ${newCount}건`);

    // 7) 리포트 + 이메일
    const md = buildReportMarkdown(newItems);
    const html = markdownToHtml(md);
    const today = new Date().toISOString().slice(0, 10);
    const agentCount = newItems.filter(i => i.aiIsAgent).length;
    const subject = `[g2b 채용 리포트] ${today} 신규 ${newCount}건 (채용대행 ${agentCount}건)`;

    // 첨부: 마크다운 원본 + 채용대행 공고만 파일 ZIP
    const attachments = [
      { filename: `report-${today}.md`, content: Buffer.from(md, 'utf-8') },
    ];
    // 채용대행 공고 첨부파일만 (AI 판단 true 인 것)
    const agentItems = newItems.filter(i => i.aiIsAgent === true);
    const allFiles = agentItems.flatMap(it => {
      const folder = `${safePathPart(it.bidNo)}_${safePathPart(it.name).slice(0, 60)}`;
      return (it._downloaded || []).map(f => ({
        name: `${folder}/${safePathPart(f.name)}`,
        bytes: f.bytes,
      }));
    });
    if (allFiles.length) {
      const zipBuf = await new Promise((resolve, reject) => {
        const chunks = [];
        const sink = new Writable({
          write(c, _e, cb) { chunks.push(c); cb(); },
        });
        sink.on('finish', () => resolve(Buffer.concat(chunks)));
        sink.on('error', reject);
        const ar = archiver('zip', { zlib: { level: 9 } });
        ar.on('error', reject);
        ar.pipe(sink);
        for (const f of allFiles) ar.append(f.bytes, { name: f.name });
        ar.finalize();
      });
      attachments.push({ filename: `files-${today}.zip`, content: zipBuf });
    }

    const recipients = await getActiveRecipients();
    if (!recipients.length) {
      console.log('[cron] 활성 수신자 0명 — 이메일 발송 스킵');
    } else {
      await sendReport({ subject, html, text: md, attachments, to: recipients });
      emailSent = true;
      console.log(`[cron] 이메일 발송 완료 → ${recipients.length}명: ${recipients.map(r => r.email).join(', ')}`);
    }

    status = 'success';
  } catch (e) {
    status = 'failed';
    errorMsg = `${e.name}: ${e.message}\n${e.stack}`;
    console.error('[cron] 실패:', errorMsg);
  } finally {
    await finishCronRun(cronId, { status, totalFound, newCount, emailSent, errorMsg });
    // 풀 종료
    const pool = (await import('./lib/db.js')).default;
    await pool.end();
  }
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
