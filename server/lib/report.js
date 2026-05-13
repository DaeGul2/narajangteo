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

// 마크다운 + 카드 마커 → HTML (모든 스타일 inline — 메일 클라이언트 호환)
export function markdownToHtml(md) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = md.split(/\r?\n/);
  const out = [];

  // 색상 팔레트
  const C = {
    text: '#0f172a',
    textSub: '#334155',
    textMuted: '#64748b',
    textLight: '#94a3b8',
    border: '#e2e8f0',
    bg: '#f8fafc',
    bgCard: '#ffffff',
    accent: '#0f172a',
    accentLight: '#1e293b',
  };

  const FF = "'Apple SD Gothic Neo','Pretendard','Malgun Gothic',Arial,sans-serif";

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // 카드 블록 → inline-style div
    if (line.trim() === '::CARD_START::') {
      const meta = { AGENCY: '', NAME: '', BIDNO: '', AGENT: 'N', REASON: '' };
      i++;
      while (i < lines.length && lines[i].trim() !== '::CARD_END::') {
        const m = lines[i].match(/^([A-Z]+)::(.*)$/);
        if (m) meta[m[1]] = m[2];
        i++;
      }
      i++;
      const isAgent = meta.AGENT === 'Y';
      const cardBg = isAgent ? '#f8fafc' : '#ffffff';
      const borderLeft = isAgent ? `4px solid ${C.accent}` : `4px solid #cbd5e1`;
      const badgeBg = isAgent ? C.accent : '#e2e8f0';
      const badgeFg = isAgent ? '#ffffff' : C.textSub;
      const badgeLabel = isAgent ? '채용대행' : '그 외';

      out.push(
        `<div style="background:${cardBg};border:1px solid ${C.border};border-left:${borderLeft};border-radius:8px;padding:18px 22px;margin:18px 0 6px;">` +
          `<div style="font-size:13px;color:${C.textMuted};font-weight:600;">${esc(meta.AGENCY)}</div>` +
          `<div style="font-size:19px;font-weight:700;color:${C.text};margin:5px 0 12px;line-height:1.35;">${esc(meta.NAME)}</div>` +
          `<div style="font-size:12.5px;">` +
            `<span style="font-family:'Consolas','Menlo',monospace;background:#e2e8f0;color:${C.textSub};padding:2px 8px;border-radius:3px;font-size:12px;margin-right:8px;">${esc(meta.BIDNO)}</span>` +
            `<span style="display:inline-block;background:${badgeBg};color:${badgeFg};padding:3px 10px;border-radius:3px;font-weight:600;font-size:11.5px;">${badgeLabel}</span>` +
            (meta.REASON ? `<div style="color:${C.textMuted};font-size:12px;margin-top:6px;">${esc(meta.REASON)}</div>` : '') +
          `</div>` +
        `</div>`
      );
      continue;
    }

    if (/^# /.test(line)) {
      out.push(`<h1 style="font-size:22px;font-weight:700;letter-spacing:-0.3px;margin:0 0 8px;color:${C.text};">${esc(line.slice(2))}</h1>`);
      i++; continue;
    }
    if (/^## /.test(line)) {
      out.push(`<h2 style="font-size:16px;font-weight:700;margin:32px 0 16px;padding:10px 16px;background:${C.accent};color:#ffffff;border-radius:6px;letter-spacing:-0.2px;">${esc(line.slice(3))}</h2>`);
      i++; continue;
    }
    if (/^### /.test(line)) {
      out.push(`<h3 style="font-size:14px;margin-top:20px;color:${C.textSub};">${esc(line.slice(4))}</h3>`);
      i++; continue;
    }
    if (/^---\s*$/.test(line)) {
      out.push(`<hr style="border:0;border-top:1px dashed #cbd5e1;margin:20px 0;"/>`);
      i++; continue;
    }

    if (/^- /.test(line)) {
      out.push(`<ul style="padding-left:20px;margin:10px 0 16px;">`);
      while (i < lines.length && /^- /.test(lines[i])) {
        let txt = esc(lines[i].slice(2));
        txt = txt.replace(/\*\*(.+?)\*\*/g, `<strong style="color:${C.text};font-weight:700;">$1</strong>`);
        out.push(`<li style="margin:4px 0;color:${C.textSub};line-height:1.6;">${txt}</li>`);
        i++;
        while (i < lines.length && /^\s{2,}ㅇ /.test(lines[i])) {
          out.push(`<li style="list-style:none;margin-left:-12px;color:${C.textMuted};font-size:13.5px;line-height:1.65;">${esc(lines[i].trim())}</li>`);
          i++;
        }
      }
      out.push(`</ul>`);
      continue;
    }

    if (line.trim() === '') { out.push(''); i++; continue; }
    let txt = esc(line);
    txt = txt.replace(/\*\*(.+?)\*\*/g, `<strong style="color:${C.text};font-weight:700;">$1</strong>`);
    out.push(`<p style="margin:6px 0;color:${C.textSub};line-height:1.6;">${txt}</p>`);
    i++;
  }

  // 외부 link/style 없이 inline 만 — 메일 클라이언트 호환성 최대화
  return `<div style="max-width:760px;margin:0 auto;font-family:${FF};color:${C.text};line-height:1.6;background:${C.bg};padding:28px 24px;font-size:14px;">${out.join('\n')}</div>`;
}
