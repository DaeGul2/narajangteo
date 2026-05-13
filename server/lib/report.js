// 신규 공고 리스트 → 사용자 정의 마크다운 리포트 (HTML 변환도 포함)
// 업체명·공고명을 카드 헤더로 부각

function safeStr(s) { return String(s || '').trim(); }

// GPT 요약 앞부분(공고번호 줄 + 업체명/공고명 라인) 제거 — 카드 헤더와 중복이라
function stripHeader(md) {
  if (!md) return '';
  const lines = md.split(/\r?\n/);
  const out = [];
  let stripped = 0;
  for (const line of lines) {
    if (stripped < 4) {
      if (/^[A-Z0-9]+\s*-\s*\d+\s*$/.test(line.trim())) { stripped++; continue; }
      if (/^-\s*업체명\s*:/.test(line)) { stripped++; continue; }
      if (/^-\s*공고명\s*:/.test(line)) { stripped++; continue; }
      if (line.trim() === '' && stripped > 0) continue;
    }
    out.push(line);
  }
  return out.join('\n').trim();
}

function renderNotice(it) {
  const agency = safeStr(it.demander || it.agency || '발주기관 미상');
  const name = safeStr(it.name || '공고명 미상');
  const bidNo = safeStr(it.bidNo);
  const isAgent = it.aiIsAgent === true;

  const lines = [];
  // 카드 마커 — markdownToHtml 에서 박스로 렌더
  lines.push('::CARD_START::');
  lines.push(`AGENCY::${agency}`);
  lines.push(`NAME::${name}`);
  lines.push(`BIDNO::${bidNo}`);
  lines.push(`AGENT::${isAgent ? 'Y' : 'N'}`);
  if (it.aiReason) lines.push(`REASON::${safeStr(it.aiReason)}`);
  lines.push('::CARD_END::');
  lines.push('');

  // GPT 요약 본문 (중복 라인 제거)
  if (it.summary_md && it.summary_md.trim()) {
    lines.push(stripHeader(it.summary_md));
  } else {
    lines.push('- 채용규모: 미상 (파일 추출 실패)');
    const tel = it.dmstPic?.[0]?.tlphNo || '';
    const dept = it.dmstPic?.[0]?.deptNm || '';
    lines.push(`- 담당자: ${dept}${tel ? `(${tel})` : ''}`);
    lines.push('- 제출기간\n  ㅇ 입찰서 - 미상\n  ㅇ 제안서 - 미상');
    lines.push(`- 가격: ${it.bgtAmt || it.prspPrce || '미상'}`);
    lines.push('- 평가정보: 미상');
  }

  // 이전 채용대행 기록
  if (it.prevHistory && it.prevHistory.length > 0) {
    const parts = it.prevHistory.map(p => `${p.year}-${p.agencies.join('·')}`);
    lines.push(`- 기타: ${parts.join(' / ')}`);
  }
  return lines.join('\n');
}

export function buildReportMarkdown(items, runDate) {
  const date = runDate || new Date().toISOString().slice(0, 10);
  const agentItems = items.filter(i => i.aiIsAgent === true);
  const otherItems = items.filter(i => i.aiIsAgent !== true);

  const md = [];
  md.push(`# ${date} 나라장터 채용대행 신규 공고`);
  md.push('');
  md.push(`총 **${items.length}건** 신규 — AI 판단 **채용대행 ${agentItems.length}건** · 그 외 ${otherItems.length}건`);
  md.push('');
  md.push('---');
  md.push('');
  if (agentItems.length) {
    md.push('## ✓ 채용대행 용역');
    md.push('');
    for (const it of agentItems) {
      md.push(renderNotice(it));
      md.push('');
    }
  }
  if (otherItems.length) {
    md.push('## · 그 외 채용업무 (참고)');
    md.push('');
    for (const it of otherItems) {
      md.push(renderNotice(it));
      md.push('');
    }
  }
  return md.join('\n');
}

// 마크다운 + 카드 마커 → HTML
export function markdownToHtml(md) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = md.split(/\r?\n/);
  const out = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // 카드 블록
    if (line.trim() === '::CARD_START::') {
      const meta = { AGENCY: '', NAME: '', BIDNO: '', AGENT: 'N', REASON: '' };
      i++;
      while (i < lines.length && lines[i].trim() !== '::CARD_END::') {
        const m = lines[i].match(/^([A-Z]+)::(.*)$/);
        if (m) meta[m[1]] = m[2];
        i++;
      }
      i++; // ::CARD_END::
      const badge = meta.AGENT === 'Y'
        ? '<span class="b-agent">채용대행</span>'
        : '<span class="b-other">그 외</span>';
      out.push(`<div class="notice-card ${meta.AGENT === 'Y' ? 'agent' : 'other'}">
  <div class="card-agency">${esc(meta.AGENCY)}</div>
  <div class="card-name">${esc(meta.NAME)}</div>
  <div class="card-meta"><code>${esc(meta.BIDNO)}</code>${badge}${meta.REASON ? `<span class="card-reason">${esc(meta.REASON)}</span>` : ''}</div>
</div>`);
      continue;
    }

    if (/^# /.test(line)) { out.push(`<h1>${esc(line.slice(2))}</h1>`); i++; continue; }
    if (/^## /.test(line)) { out.push(`<h2>${esc(line.slice(3))}</h2>`); i++; continue; }
    if (/^### /.test(line)) { out.push(`<h3>${esc(line.slice(4))}</h3>`); i++; continue; }
    if (/^---\s*$/.test(line)) { out.push('<hr/>'); i++; continue; }

    if (/^- /.test(line)) {
      out.push('<ul>');
      while (i < lines.length && /^- /.test(lines[i])) {
        let txt = esc(lines[i].slice(2));
        txt = txt.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        out.push(`<li>${txt}</li>`);
        i++;
        while (i < lines.length && /^\s{2,}ㅇ /.test(lines[i])) {
          out.push(`<li class="sub">${esc(lines[i].trim())}</li>`);
          i++;
        }
      }
      out.push('</ul>');
      continue;
    }

    if (line.trim() === '') { out.push(''); i++; continue; }
    let txt = esc(line);
    txt = txt.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    out.push(`<p>${txt}</p>`);
    i++;
  }

  return `<!doctype html><html><head><meta charset="utf-8">
  <link rel="preconnect" href="https://cdn.jsdelivr.net">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
  <style>
    body { font-family: 'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif;
           color: #0f172a; line-height: 1.6; max-width: 760px; margin: 0 auto; padding: 28px 24px; background: #f8fafc; font-size: 14px; }
    h1 { font-size: 22px; font-weight: 700; letter-spacing: -0.3px; margin: 0 0 8px; color: #0f172a; }
    h2 { font-size: 16px; font-weight: 700; margin: 32px 0 16px; padding: 9px 16px;
         background: #0f172a; color: #fff; border-radius: 6px; letter-spacing: -0.2px; }
    h3 { font-size: 14px; margin-top: 20px; color: #475569; }
    p { margin: 6px 0; color: #334155; }
    hr { border: 0; border-top: 1px dashed #cbd5e1; margin: 20px 0; }
    code { font-family: 'JetBrains Mono', 'Consolas', monospace; background: #e2e8f0; padding: 2px 7px; border-radius: 3px; font-size: 12px; color: #475569; }
    ul { padding-left: 20px; margin: 10px 0 16px; }
    li { margin: 3px 0; color: #1e293b; }
    li.sub { list-style: none; margin-left: -12px; color: #475569; font-size: 13.5px; }
    strong { color: #0f172a; font-weight: 700; }

    /* 카드 — 업체명·공고명 부각 */
    .notice-card { background: #fff; border: 1px solid #e2e8f0; border-left: 4px solid #cbd5e1;
                   border-radius: 8px; padding: 18px 22px; margin: 18px 0 6px;
                   box-shadow: 0 1px 3px rgba(15,23,42,0.04); }
    .notice-card.agent { border-left-color: #0f172a; background: #f8fafc; }
    .card-agency { font-size: 13px; color: #64748b; font-weight: 600; letter-spacing: -0.1px; }
    .card-name { font-size: 19px; font-weight: 700; color: #0f172a; letter-spacing: -0.4px;
                 margin: 5px 0 12px; line-height: 1.35; }
    .card-meta { display: flex; align-items: center; gap: 10px; font-size: 12.5px; flex-wrap: wrap; }
    .b-agent { background: #0f172a; color: #fff; padding: 3px 10px; border-radius: 3px; font-weight: 600; font-size: 11.5px; }
    .b-other { background: #e2e8f0; color: #475569; padding: 3px 10px; border-radius: 3px; font-weight: 600; font-size: 11.5px; }
    .card-reason { color: #64748b; font-size: 12px; flex-basis: 100%; margin-top: 4px; }
  </style></head><body>${out.join('\n')}</body></html>`;
}
