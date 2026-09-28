// 해외(태국) 공고 크롤링 — 자동 실행 (하루 2회: 오전 슬롯 + 오후 슬롯, index.js 스케줄러)
// ⚠ 인사바른 채용대행 크롤러(cron.js / notices / recipients) 와는 완전 별개. 공유하는 건 g2b 검색 함수뿐.
//
// v4 흐름 (2026-09-16):
//   활성 소스 순회 → 목록 수집 → (source, notice_key) 신규만 INSERT
//     → 신규를 판별: 규칙 A(태국 명시, GPT 안 거침) / GPT B(동남아·아세안 권역) / X(제외) + 유형·주제
//     → A·B 만 요약: g2b 는 검색 행의 마감·금액 그대로, 나머지는 상세 페이지 → GPT (마감·금액·주제)
//     → 메일: [A 태국 확정] → [B 동남아·아세안] 섹션, D-day 배지·금액·주제, 마감 임박순
//     → overseas_cron_runs 로그
//
// 사용:
//   node cron_overseas.js                         # DB days_back (g2b 검색 창) 사용
//   node cron_overseas.js --days=365 --only=g2b --mail-since=2026-09-09
//       → 백필: g2b 1년치 저장, 메일은 게시일 2026-09-09 이후 것만 (첫 실행용)
//   node cron_overseas.js --no-mail               # 저장·판별만
//   node cron_overseas.js --include-unsent-since=2026-09-16
//       → 이번 실행 신규 외에, 그 날짜 이후 저장됐지만 아직 메일 안 나간 A·B 도 같이 발송 (재판별·발송 실패 복구용)
//
// 게시일 컷오프(POSTED_FROM / --mail-since): 오래된 공고가 메일에 실리지 않도록 그 이후 것만 발송.
// 게시일이 없는 공고는 최신 여부를 알 수 없으므로 놓치지 않도록 발송에 포함한다.

import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import pool, {
  getActiveOverseasRecipients,
  startOverseasCronRun, finishOverseasCronRun,
  listOverseasSources, touchOverseasSourceCrawl,
  insertOverseasNotice, markOverseasNoticesEmailed, updateOverseasNoticeAnalysis,
  getOverseasCronSettings,
} from './lib/db.js';
import { crawlSource, KEYWORDS } from './lib/overseasCrawl.js';

// 판별 힌트 — 소스별로 "게시판 주인이 태국 소재 기관인가" 와 GPT 에 줄 기관명
//   branchThai: 문화원·교육원·KOTRA 방콕무역관(담당사업 목록) 은 게시판 자체가 태국 주체 → 규칙 A
//   orgHint   : 수협·지식재산보호원은 본사 공용 게시판이라 지사명을 주면 GPT 가 오판 → 본사명으로
const SOURCE_HINT = {
  kcca:    { branchThai: true,  orgHint: '주태국 한국문화원 (태국 방콕 소재)' },
  kec:     { branchThai: true,  orgHint: '태국한국교육원 (태국 방콕 소재)' },
  kotra:   { branchThai: true,  orgHint: 'KOTRA 방콕무역관 담당 사업 목록' },
  suhyup:  { branchThai: false, orgHint: '수협중앙회 (본사 공용 입찰공고 게시판)' },
  koipa:   { branchThai: false, orgHint: '한국지식재산보호원 (본사 공용 공고 게시판)' },
  // aT enjoykfood 는 방콕지사 자체 사이트 — 특이케이스: 제목 무관 신규 전부 A 로 발송 (인도 등 관할 타국 공고 포함, 사용자 결정 2026-09-28).
  // 계기: 2026-09-23 "K-스트리트푸드 팝업"(본문에만 '방콕에서') 을 제목 판별로 X 처리해 놓침
  at:      { branchThai: false, orgHint: 'aT 아세안지역본부 방콕지사',
             forceAll: true, ruleReason: 'aT 방콕지사 사이트 — 신규 전건 발송 (특이케이스)' },
  bizinfo: { branchThai: false, orgHint: '기업마당 (전국 지원사업 포털)' },
  kofice:  { branchThai: false, orgHint: '한국국제문화교류진흥원 KOFICE (본사 입찰공고 게시판)' },
  kocca:   { branchThai: false, orgHint: '한국콘텐츠진흥원 KOCCA (본사 지원공고·사업공고 게시판)' },
  gbsa:    { branchThai: false, orgHint: '경기도경제과학진흥원 GBSA (본사 입찰정보 게시판)' },
  sba:     { branchThai: false, orgHint: '서울경제진흥원 SBA (사업공고 게시판)',
             ruleRe: /글로벌\s*거점|해외\s*거점|리테일\s*채널|파트너사/, ruleReason: 'SBA 해외 거점·파트너사 제도 — 태국 법인 직접 응모 가능' },
  kosme:   { branchThai: false, orgHint: '중소벤처기업진흥공단 해외지사화 포털 (공지사항)',
             ruleRe: /(해외민간네트워크|해외지사화).*(모집|공고)/, ruleReason: '중진공 해외민간네트워크·지사화 제도 — 태국 법인 직접 등록 가능' },
  g2b:     { branchThai: false, orgHint: null },   // 검색 행의 발주기관명 그대로
};
export function classifyInput(it) {
  const h = SOURCE_HINT[it.source] || {};
  const forceA = !!h.forceAll || !!(h.ruleRe && h.ruleRe.test(it.title || ''));
  return {
    title: it.title,
    org: h.orgHint === null || h.orgHint === undefined ? (it.organization || '') : h.orgHint,
    branchThai: !!h.branchThai,
    forceA, forceAReason: forceA ? h.ruleReason : null,
  };
}
import { classifyOverseas } from './lib/overseasClassify.js';
import { summarizeOverseasNotice, ddayOf } from './lib/overseasSummarize.js';
import { sendReport } from './lib/email.js';

function arg(name, def) {
  const m = process.argv.find(a => a.startsWith(`--${name}=`));
  return m ? m.split('=').slice(1).join('=') : def;
}
const NO_MAIL = process.argv.includes('--no-mail');
const INCLUDE_UNSENT_SINCE = arg('include-unsent-since', null);
const ONLY = (arg('only', '') || '').split(',').map(s => s.trim()).filter(Boolean);
// 이 날짜 이후 게시글만 메일 발송 (저장은 전부 — 중복 판정용)
const POSTED_FROM = arg('mail-since', null) || process.env.OVERSEAS_POSTED_FROM || '2026-01-01';

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 제목의 관심 키워드에 형광펜 — 반드시 esc() 이후에 적용 (태그를 직접 넣기 때문)
function highlight(escaped) {
  const pattern = KEYWORDS
    .slice()
    .sort((a, b) => b.length - a.length)   // 긴 키워드 우선 (부분 겹침 방지)
    .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  return escaped.replace(
    new RegExp(`(${pattern})`, 'gi'),
    '<span style="background:#fff2a8;font-weight:bold;">$1</span>'
  );
}

function ddayBadge(deadline) {
  const d = ddayOf(deadline);
  if (d == null) return `<span style="display:inline-block;font-family:Consolas,monospace;font-size:11px;padding:1px 6px;border-radius:4px;background:#eef0ec;color:#6b7280;border:1px solid #dce0da;">마감 미상</span>`;
  if (d < 0) return `<span style="display:inline-block;font-family:Consolas,monospace;font-size:11px;padding:1px 6px;border-radius:4px;background:#eef0ec;color:#6b7280;border:1px solid #dce0da;">마감</span>`;
  const hot = d <= 7;
  const bg = hot ? '#fff4e0' : '#e3f3f0', fg = hot ? '#b45309' : '#0f766e', bd = hot ? '#f0c27a' : '#8fd0c6';
  return `<span style="display:inline-block;font-family:Consolas,monospace;font-size:11px;padding:1px 6px;border-radius:4px;background:${bg};color:${fg};border:1px solid ${bd};font-weight:bold;">D-${d}</span>`;
}

// 마감 임박순 (마감 없는 건 뒤, 지난 건 맨 뒤)
function byDeadline(a, b) {
  const da = ddayOf(a.deadline), db = ddayOf(b.deadline);
  const ra = da == null ? 1e6 : da < 0 ? 2e6 - da : da;
  const rb = db == null ? 1e6 : db < 0 ? 2e6 - db : db;
  if (ra !== rb) return ra - rb;
  return String(b.postedAt || '').localeCompare(String(a.postedAt || ''));
}

// A/B 섹션 → inline-style HTML (메일플러그 호환: 외부 CSS 금지)
export function buildEmailHtml({ a, b }) {
  const dateStr = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' });
  const section = (title, color, items) => {
    if (!items.length) return '';
    const rows = items.slice().sort(byDeadline).map(it => `
      <tr>
        <td style="border:1px solid #d8dee8;padding:7px 8px;text-align:center;white-space:nowrap;vertical-align:top;">${ddayBadge(it.deadline)}</td>
        <td style="border:1px solid #d8dee8;padding:7px 8px;vertical-align:top;">
          <div style="font-size:11px;color:#888;margin-bottom:2px;">${esc(it.organization)}${it.sourceName && it.sourceName !== it.organization ? ` · <span style="color:#aaa">${esc(it.sourceName)}</span>` : ''}</div>
          <a href="${esc(it.url)}" style="color:#1a56b0;text-decoration:none;font-size:13.5px;">${highlight(esc(it.title))}</a>
          <div style="font-size:12px;color:#555;margin-top:3px;">
            ${it.noticeType ? `<span style="font-family:Consolas,monospace;font-size:11px;color:#1a3e6e;border:1px solid #c9d4e5;border-radius:3px;padding:0 5px;margin-right:6px;">${esc(it.noticeType)}</span>` : ''}
            ${it.amount ? `<b>${esc(it.amount)}</b>` : '<span style="color:#999">금액 미상</span>'}
            ${it.topic ? ` · ${esc(it.topic)}` : ''}
            ${it.deadline ? ` · <span style="color:#888">마감 ${esc(it.deadline)}</span>` : ''}
          </div>
          ${it.summary ? `<div style="font-size:12px;color:#666;margin-top:4px;line-height:1.45;">${esc(it.summary)}</div>` : ''}
        </td>
      </tr>`).join('');
    return `
      <div style="margin:0 0 26px 0;">
        <h3 style="margin:0 0 8px 0;font-size:15px;color:${color};border-left:4px solid ${color};padding-left:8px;">
          ${esc(title)} <span style="font-weight:normal;color:#888;">(${items.length}건)</span>
        </h3>
        <table style="border-collapse:collapse;width:100%;font-size:13px;">
          <tr style="background:#f2f5fa;">
            <th style="border:1px solid #d8dee8;padding:6px 8px;width:72px;">D-day</th>
            <th style="border:1px solid #d8dee8;padding:6px 8px;text-align:left;">공고</th>
          </tr>
          ${rows}
        </table>
      </div>`;
  };
  return `
    <div style="font-family:'Malgun Gothic',Apple SD Gothic Neo,sans-serif;max-width:800px;margin:0 auto;color:#222;">
      <h2 style="font-size:19px;margin:0 0 4px 0;">🌏 해외(태국) 공고 — 신규 알림</h2>
      <div style="color:#888;font-size:12px;margin-bottom:18px;">${dateStr} · 나라장터 + 공공기관 방콕지사 모니터링 · 마감 임박순 · <b style="color:#b45309">D-7 이내 강조</b></div>
      ${section('A · 태국 확정 (제목에 태국·방콕·태국 행사 명시)', '#0f766e', a)}
      ${section('B · 동남아·아세안 권역 (태국 포함 가능성)', '#b45309', b)}
      <div style="color:#aaa;font-size:11px;margin-top:24px;border-top:1px solid #eee;padding-top:8px;">
        이 메일은 해외 공고 크롤러가 자동 발송했습니다. 금액이 "미상" 인 건은 첨부 공고문에만 기재된 경우입니다.
      </div>
    </div>`;
}

async function main() {
  console.log(`[overseas-cron] 시작${ONLY.length ? ` (only=${ONLY.join(',')})` : ''}${NO_MAIL ? ' (no-mail)' : ''} mail-since=${POSTED_FROM}`);
  const runId = await startOverseasCronRun();
  let totalFound = 0, newCount = 0, emailSent = false;
  const errors = [];

  // g2b 검색 창(일) — --days 우선, 없으면 DB days_back
  let daysBack = Number(arg('days', 0)) || 0;
  if (!daysBack) {
    try { daysBack = Number((await getOverseasCronSettings()).days_back) || 5; } catch { daysBack = 5; }
  }

  try {
    let sources = (await listOverseasSources()).filter(s => s.enabled);
    if (ONLY.length) sources = sources.filter(s => ONLY.includes(s.source_key));
    console.log(`[overseas-cron] 활성 소스 ${sources.length}개: ${sources.map(s => s.source_key).join(', ') || '(없음)'} · g2b 창 ${daysBack}일`);

    // ── 1) 수집 + 신규 INSERT ──
    const fresh = [];   // [{source, sourceName, noticeKey, title, url, postedAt, organization, deadline, amount}]
    for (const src of sources) {
      try {
        const items = await crawlSource(src.source_key, { daysBack });
        totalFound += items.length;
        let n = 0;
        for (const it of items) {
          const organization = it.agency || src.name;
          const inserted = await insertOverseasNotice({
            source: src.source_key, noticeKey: it.noticeKey, title: it.title,
            organization, url: it.url, postedAt: it.postedAt,
            deadline: it.deadline || null, amount: it.amount || null,
          });
          if (inserted) {
            n++;
            fresh.push({ ...it, source: src.source_key, sourceName: src.name, organization });
          }
        }
        newCount += n;
        console.log(`[overseas-cron] ${src.source_key}: 수집 ${items.length} · 신규 ${n}`);
        await touchOverseasSourceCrawl(src.id, { status: 'ok' });
      } catch (e) {
        console.error(`[overseas-cron] ${src.source_key} 실패:`, e.message);
        errors.push(`${src.source_key}: ${e.message}`);
        await touchOverseasSourceCrawl(src.id, { status: 'error', error: e.message });
      }
    }

    // ── 2) 판별 (규칙 A → GPT B/X) ──
    const graded = { A: [], B: [], X: [], none: [] };
    if (fresh.length) {
      const cls = await classifyOverseas(fresh.map((f, i) => ({ id: String(i), ...classifyInput(f) })));
      for (let i = 0; i < fresh.length; i++) {
        const r = cls.get(String(i)) || { grade: null, type: '', topic: '', reason: 'GPT 미판정' };
        fresh[i].grade = r.grade;
        fresh[i].noticeType = r.type || null;
        fresh[i].topic = r.topic || null;
        fresh[i].aiReason = r.reason || null;
        await updateOverseasNoticeAnalysis(fresh[i].source, fresh[i].noticeKey, {
          grade: r.grade, noticeType: r.type, topic: r.topic, aiReason: r.reason,
        });
        (graded[r.grade || 'none']).push(fresh[i]);
      }
      console.log(`[overseas-cron] 판별 — A ${graded.A.length} · B ${graded.B.length} · X ${graded.X.length} · 미판정 ${graded.none.length}`);
    }

    // ── 3) 요약 (A·B 만) — g2b 는 검색 행 값 그대로, 나머지는 상세 페이지 → GPT ──
    // GPT 미판정(키 없음·장애)은 놓치지 않도록 A 와 같이 취급해 발송한다.
    const mailable = it => !it.postedAt || it.postedAt >= POSTED_FROM;
    const listA = [...graded.A, ...graded.none].filter(mailable);
    const listB = graded.B.filter(mailable);
    const skippedOld = graded.A.length + graded.none.length + graded.B.length - listA.length - listB.length;

    // --include-unsent-since: 이미 저장됐지만 아직 메일 안 나간 A·B 도 합류 (요약은 이미 돼 있으면 그대로)
    if (INCLUDE_UNSENT_SINCE) {
      const [rows] = await pool.query(
        `SELECT n.source, s.name AS source_name, n.notice_key, n.title, n.organization, n.url, n.posted_at, n.deadline, n.amount,
                n.grade, n.notice_type, n.topic, n.summary_md
         FROM overseas_notices n LEFT JOIN overseas_sources s ON s.source_key = n.source
         WHERE n.email_sent_at IS NULL AND n.grade IN ('A','B') AND n.created_at >= ?`, [INCLUDE_UNSENT_SINCE]
      );
      const have = new Set([...listA, ...listB].map(x => `${x.source}|${x.noticeKey}`));
      let added = 0;
      for (const r of rows) {
        if (have.has(`${r.source}|${r.notice_key}`)) continue;
        const it = {
          source: r.source, sourceName: r.source_name || r.source, noticeKey: r.notice_key, title: r.title,
          organization: r.organization, url: r.url, postedAt: r.posted_at, deadline: r.deadline, amount: r.amount,
          grade: r.grade, noticeType: r.notice_type, topic: r.topic,
          summary: r.summary_md ? String(r.summary_md).split('\n\n')[0] : null,
          _needSummary: !r.summary_md && r.source !== 'g2b',
        };
        if (!mailable(it)) continue;
        (r.grade === 'A' ? listA : listB).push(it);
        added++;
      }
      console.log(`[overseas-cron] --include-unsent-since=${INCLUDE_UNSENT_SINCE}: 미발송 A·B ${added}건 합류`);
    }
    for (const it of [...listA, ...listB]) {
      if (it.source === 'g2b') continue;   // deadline/amount 이미 있음 (없으면 미상)
      if (it.summary !== undefined && !it._needSummary) continue;   // 합류분 중 이미 요약된 건
      try {
        const s = await summarizeOverseasNotice({ title: it.title, url: it.url, organization: it.organization });
        if (s.error) console.log(`[overseas-cron]   요약 스킵 ${it.source}/${it.noticeKey}: ${s.error}`);
        it.deadline = s.deadline || it.deadline || null;
        it.amount = s.amount || it.amount || null;
        it.topic = s.topic || it.topic || null;
        it.summary = s.summary || null;
        await updateOverseasNoticeAnalysis(it.source, it.noticeKey, {
          deadline: it.deadline, amount: it.amount, topic: it.topic,
          summaryMd: s.summary ? `${s.summary}${s.contact ? `\n\n담당: ${s.contact}` : ''}${s.deadlineKind ? `\n\n마감 종류: ${s.deadlineKind}` : ''}` : undefined,
        });
      } catch (e) {
        console.log(`[overseas-cron]   요약 실패 ${it.source}/${it.noticeKey}: ${e.message}`);
      }
    }

    // ── 4) 메일 ──
    const mailCount = listA.length + listB.length;
    if (skippedOld) console.log(`[overseas-cron] ${skippedOld}건은 ${POSTED_FROM} 이전 게시글이라 메일 제외`);
    if (mailCount && !NO_MAIL) {
      const recipients = await getActiveOverseasRecipients();
      if (recipients.length) {
        const today = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
        const parts = [];
        if (listA.length) parts.push(`태국 ${listA.length}건`);
        if (listB.length) parts.push(`동남아·아세안 ${listB.length}건`);
        await sendReport({
          subject: `[해외공고] ${parts.join(' · ')} — ${today}`,
          html: buildEmailHtml({ a: listA, b: listB }),
          to: recipients,
          fromName: '해외공고 크롤러',
        });
        emailSent = true;
        const bySrc = new Map();
        for (const it of [...listA, ...listB]) {
          if (!bySrc.has(it.source)) bySrc.set(it.source, []);
          bySrc.get(it.source).push(it.noticeKey);
        }
        for (const [src, keys] of bySrc) await markOverseasNoticesEmailed(src, keys);
        console.log(`[overseas-cron] 메일 발송 완료 → ${recipients.length}명 (A ${listA.length} · B ${listB.length})`);
      } else {
        console.log('[overseas-cron] 발송 대상 있으나 활성 수신자 없음 — 메일 스킵');
      }
    } else {
      console.log(`[overseas-cron] 메일 스킵 (발송 대상 ${mailCount}건${NO_MAIL ? ', --no-mail' : ''})`);
    }

    await finishOverseasCronRun(runId, {
      status: errors.length && !totalFound ? 'failed' : 'success',
      totalFound, newCount, emailSent,
      errorMsg: errors.length ? errors.join('\n') : null,
    });
    console.log(`[overseas-cron] 완료 — 수집 ${totalFound}, 신규 ${newCount}, A ${graded.A.length} / B ${graded.B.length} / X ${graded.X.length}, 메일 ${emailSent ? 'O' : 'X'}`);
  } catch (e) {
    console.error('[overseas-cron] 실패:', e);
    await finishOverseasCronRun(runId, {
      status: 'failed', totalFound, newCount, emailSent, errorMsg: e.message,
    });
  } finally {
    await pool.end();
  }
}

// 직접 실행일 때만 크롤 — import 시(테스트 등)에는 buildEmailHtml 만 쓰도록
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error('[overseas-cron] fatal:', e); process.exit(1); });
}
