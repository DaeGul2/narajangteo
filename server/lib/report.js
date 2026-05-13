// 신규 공고 리스트 → 사용자 정의 마크다운 리포트 (HTML 변환도 포함)

function renderNotice(it) {
  const bidNo = it.bidNo || '';
  const lines = [];
  lines.push(`### ${bidNo}`);
  lines.push('');
  // AI 분류 결과 표시 (참고용)
  if (it.aiIsAgent === true) lines.push(`> 🤖 AI: **채용대행 용역**${it.aiReason ? ' — ' + it.aiReason : ''}`);
  else if (it.aiIsAgent === false) lines.push(`> 🤖 AI: 그 외 아웃소싱${it.aiReason ? ' — ' + it.aiReason : ''}`);
  lines.push('');

  // GPT 요약이 있으면 그대로 사용 (사용자 포맷)
  if (it.summary_md && it.summary_md.trim()) {
    lines.push(it.summary_md.trim());
  } else {
    // 폴백: 메타데이터 기반 기본 포맷
    lines.push(`- 업체명: ${it.demander || it.agency || '미상'}`);
    lines.push(`- 공고명: ${it.name || '미상'}`);
    lines.push(`- 채용규모: 미상 (파일 추출 실패)`);
    const tel = it.dmstPic?.[0]?.tlphNo || '';
    const dept = it.dmstPic?.[0]?.deptNm || '';
    lines.push(`- 담당자: ${dept}${tel ? `(${tel})` : ''}`);
    lines.push(`- 제출기간`);
    lines.push(`  ㅇ 입찰서 - 미상`);
    lines.push(`  ㅇ 제안서 - 미상`);
    lines.push(`- 가격: ${it.bgtAmt || it.prspPrce || '미상'}`);
    lines.push(`- 평가정보: 미상`);
  }

  // 이전 채용대행 기록 (기타)
  if (it.prevHistory && it.prevHistory.length > 0) {
    const parts = it.prevHistory.map(p => `${p.year}-${p.agencies.join('·')}`);
    lines.push(`- 기타: ${parts.join(' / ')}`);
  } else {
    lines.push(`- 기타: 이전 채용대행 기록 없음`);
  }
  return lines.join('\n');
}

export function buildReportMarkdown(items, runDate) {
  const date = runDate || new Date().toISOString().slice(0, 10);
  const agentItems = items.filter(i => i.aiIsAgent === true);
  const otherItems = items.filter(i => i.aiIsAgent !== true);

  const md = [];
  md.push(`# 📨 ${date} 나라장터 채용대행 신규 공고 리포트`);
  md.push('');
  md.push(`총 **${items.length}건** 신규 (AI 판단 채용대행: ${agentItems.length}건, 그 외: ${otherItems.length}건)`);
  md.push('');
  md.push('---');
  md.push('');
  if (agentItems.length) {
    md.push('## 🤖 AI 판단: 채용대행 용역');
    md.push('');
    for (const it of agentItems) {
      md.push(renderNotice(it));
      md.push('');
      md.push('---');
      md.push('');
    }
  }
  if (otherItems.length) {
    md.push('## ❌ AI 판단: 그 외 채용업무 아웃소싱 (참고)');
    md.push('');
    for (const it of otherItems) {
      md.push(renderNotice(it));
      md.push('');
      md.push('---');
      md.push('');
    }
  }
  return md.join('\n');
}

// 간단 마크다운 → HTML 변환 (이메일용 미니멀)
export function markdownToHtml(md) {
  const esc = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const lines = md.split(/\r?\n/);
  const out = [];
  let inList = false;
  const flushList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  for (const raw of lines) {
    const line = raw;
    if (/^# /.test(line)) { flushList(); out.push(`<h1>${esc(line.slice(2))}</h1>`); continue; }
    if (/^## /.test(line)) { flushList(); out.push(`<h2>${esc(line.slice(3))}</h2>`); continue; }
    if (/^### /.test(line)) { flushList(); out.push(`<h3>${esc(line.slice(4))}</h3>`); continue; }
    if (/^---\s*$/.test(line)) { flushList(); out.push('<hr/>'); continue; }
    if (/^>\s/.test(line)) { flushList(); out.push(`<blockquote>${esc(line.slice(2))}</blockquote>`); continue; }
    if (/^- /.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      let txt = esc(line.slice(2));
      txt = txt.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      out.push(`<li>${txt}</li>`);
      continue;
    }
    if (/^\s{2,}ㅇ /.test(line)) {
      out.push(`<div style="margin-left:1.2em;">${esc(line.trim())}</div>`);
      continue;
    }
    flushList();
    if (line.trim() === '') { out.push(''); continue; }
    let txt = esc(line);
    txt = txt.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    out.push(`<p>${txt}</p>`);
  }
  flushList();
  return `<!doctype html><html><head><meta charset="utf-8">
  <link rel="preconnect" href="https://cdn.jsdelivr.net">
  <link rel="stylesheet" as="style" crossorigin href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
  <style>
    body{font-family:'Pretendard Variable',Pretendard,-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#1f2937;line-height:1.6;max-width:780px;margin:0 auto;padding:24px;font-size:14px;white-space:normal;}
    h1{font-size:22px;border-bottom:2px solid #2563eb;padding-bottom:8px;}
    h2{font-size:18px;margin-top:32px;color:#1e40af;}
    h3{font-size:15px;margin-top:24px;background:#f3f4f6;padding:6px 10px;border-radius:4px;font-family:'JetBrains Mono','Consolas',monospace;}
    blockquote{background:#eff6ff;border-left:3px solid #93c5fd;padding:6px 12px;margin:8px 0;color:#1e40af;font-size:13px;}
    ul{padding-left:22px;}
    li{margin:4px 0;}
    hr{border:none;border-top:1px dashed #d1d5db;margin:24px 0;}
    strong{color:#111827;}
  </style></head><body>${out.join('\n')}</body></html>`;
}
