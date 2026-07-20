// 해외 공고 크롤링 — 일일 자동 실행
// 흐름: 활성 소스(overseas_sources) 순회 → 목록 크롤 → 신규만 overseas_notices INSERT
//       → 신규 있으면 수신자에게 메일 발송 → overseas_cron_runs 로그
//
// 사용: node cron_overseas.js
// (days_back 은 이 파이프라인에서는 사용하지 않음 — 게시판 첫 페이지 diff 방식)
//
// 게시일 컷오프(POSTED_FROM): 오래된 공고까지 메일에 실리지 않도록 그 이후 것만 발송한다.
// DB 가 비어있는 첫 실행에서는 게시판에 있는 2026년 이후 공고가 한 번에 전부 나가고,
// 이후 실행부터는 새로 올라온 것만 나간다 (source+notice_key 로 중복 판정).
// 게시일이 없는 공고는 최신 여부를 알 수 없으므로 놓치지 않도록 발송에 포함한다.

import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import pool, {
  getActiveOverseasRecipients,
  startOverseasCronRun, finishOverseasCronRun,
  listOverseasSources, touchOverseasSourceCrawl,
  insertOverseasNotice, markOverseasNoticesEmailed,
} from './lib/db.js';
import { crawlSource, KEYWORDS } from './lib/overseasCrawl.js';
import { sendReport } from './lib/email.js';

// 이 날짜 이후 게시글만 메일 발송 (저장은 전부 — 중복 판정용)
const POSTED_FROM = process.env.OVERSEAS_POSTED_FROM || '2026-01-01';

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

// 게시일 최신순 (날짜 없는 건 맨 뒤)
function byPostedDesc(a, b) {
  if (!a.postedAt && !b.postedAt) return 0;
  if (!a.postedAt) return 1;
  if (!b.postedAt) return -1;
  return b.postedAt.localeCompare(a.postedAt);
}

// 기관별 신규 공고 → inline-style HTML (메일플러그 호환: 외부 CSS 금지)
export function buildEmailHtml(groups) {
  const dateStr = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });

  // 각 기관 안에서 최신순 정렬, 기관끼리도 가장 최근 공고가 있는 곳부터
  const sorted = groups
    .map(g => ({ ...g, items: g.items.slice().sort(byPostedDesc) }))
    .sort((a, b) => byPostedDesc(a.items[0] || {}, b.items[0] || {}));

  let body = '';
  for (const g of sorted) {
    body += `
      <div style="margin:0 0 24px 0;">
        <h3 style="margin:0 0 8px 0;font-size:16px;color:#1a3e6e;border-left:4px solid #1a3e6e;padding-left:8px;">
          ${esc(g.name)} <span style="font-weight:normal;color:#888;">(신규 ${g.items.length}건)</span>
        </h3>
        <table style="border-collapse:collapse;width:100%;font-size:13px;">
          <tr style="background:#f2f5fa;">
            <th style="border:1px solid #d8dee8;padding:6px 8px;text-align:left;">제목</th>
            <th style="border:1px solid #d8dee8;padding:6px 8px;width:90px;">게시일</th>
          </tr>
          ${g.items.map(it => `
          <tr>
            <td style="border:1px solid #d8dee8;padding:6px 8px;">
              <a href="${esc(it.url)}" style="color:#1a56b0;text-decoration:none;">${highlight(esc(it.title))}</a>
            </td>
            <td style="border:1px solid #d8dee8;padding:6px 8px;text-align:center;color:#555;">${esc(it.postedAt || '-')}</td>
          </tr>`).join('')}
        </table>
      </div>`;
  }
  return `
    <div style="font-family:'Malgun Gothic',Apple SD Gothic Neo,sans-serif;max-width:760px;margin:0 auto;color:#222;">
      <h2 style="font-size:19px;margin:0 0 4px 0;">🌏 해외(태국) 공고 크롤링 — 신규 공고 알림</h2>
      <div style="color:#888;font-size:12px;margin-bottom:20px;">${dateStr} · 공공기관 방콕지사 모니터링 · 게시일 최신순</div>
      ${body}
      <div style="color:#aaa;font-size:11px;margin-top:24px;border-top:1px solid #eee;padding-top:8px;">
        이 메일은 해외 공고 크롤러가 자동 발송했습니다.
      </div>
    </div>`;
}

async function main() {
  console.log('[overseas-cron] 시작');
  const runId = await startOverseasCronRun();
  let totalFound = 0, newCount = 0, emailSent = false;
  const errors = [];

  try {
    const sources = (await listOverseasSources()).filter(s => s.enabled);
    console.log(`[overseas-cron] 활성 소스 ${sources.length}개: ${sources.map(s => s.source_key).join(', ') || '(없음)'}`);

    const groups = [];  // [{name, items:[{noticeKey,title,url,postedAt}]}]
    for (const src of sources) {
      try {
        const items = await crawlSource(src.source_key);
        totalFound += items.length;
        console.log(`[overseas-cron] ${src.source_key}: ${items.length}건 수집`);

        const fresh = [];
        for (const it of items) {
          const inserted = await insertOverseasNotice({
            source: src.source_key,
            noticeKey: it.noticeKey,
            title: it.title,
            organization: src.name,
            url: it.url,
            postedAt: it.postedAt,
          });
          if (inserted) fresh.push(it);
        }
        newCount += fresh.length;
        // 저장은 전부(중복 판정용), 메일은 컷오프 이후 게시글만
        const mailable = fresh.filter(it => !it.postedAt || it.postedAt >= POSTED_FROM);
        const skipped = fresh.length - mailable.length;
        console.log(
          `[overseas-cron] ${src.source_key}: 신규 ${fresh.length}건` +
          (skipped ? ` (그중 ${skipped}건은 ${POSTED_FROM} 이전 게시글이라 메일 제외)` : '')
        );
        if (mailable.length) groups.push({ name: src.name, sourceKey: src.source_key, items: mailable });
        await touchOverseasSourceCrawl(src.id, { status: 'ok' });
      } catch (e) {
        console.error(`[overseas-cron] ${src.source_key} 실패:`, e.message);
        errors.push(`${src.source_key}: ${e.message}`);
        await touchOverseasSourceCrawl(src.id, { status: 'error', error: e.message });
      }
    }

    const mailCount = groups.reduce((n, g) => n + g.items.length, 0);
    if (groups.length) {
      const recipients = await getActiveOverseasRecipients();
      if (recipients.length) {
        const today = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
        await sendReport({
          subject: `[해외공고] 신규 ${mailCount}건 — ${today}`,
          html: buildEmailHtml(groups),
          to: recipients,   // sendReport 가 {email, name} 배열을 정규화함
        });
        emailSent = true;
        for (const g of groups) {
          await markOverseasNoticesEmailed(g.sourceKey, g.items.map(it => it.noticeKey));
        }
        console.log(`[overseas-cron] 메일 발송 완료 → ${recipients.length}명`);
      } else {
        console.log('[overseas-cron] 신규 있으나 활성 수신자 없음 — 메일 스킵');
      }
    } else {
      console.log(`[overseas-cron] 발송 대상 없음 — 메일 스킵 (신규 ${newCount}건)`);
    }

    await finishOverseasCronRun(runId, {
      status: errors.length && !totalFound ? 'failed' : 'success',
      totalFound, newCount, emailSent,
      errorMsg: errors.length ? errors.join('\n') : null,
    });
    console.log(`[overseas-cron] 완료 — 수집 ${totalFound}, 신규 ${newCount}, 메일대상 ${mailCount}, 메일 ${emailSent ? 'O' : 'X'}`);
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
