// 파일 binary → 텍스트
// .pdf  : pdf-parse
// .hwpx : rhwp WASM
// .hwp  : rhwp WASM

import path from 'node:path';

let _rhwpModule = null;
async function loadRhwp() {
  if (_rhwpModule) return _rhwpModule;
  try {
    const mod = await import('@rhwp/core');
    _rhwpModule = mod.default || mod;
    return _rhwpModule;
  } catch (e) {
    console.error('[extract] @rhwp/core 로드 실패:', e.message);
    return null;
  }
}

async function extractPdf(buf) {
  try {
    const { default: pdfParse } = await import('pdf-parse');
    const data = await pdfParse(buf);
    return data.text || '';
  } catch (e) {
    return `[PDF 추출 실패: ${e.message}]`;
  }
}

async function extractHwpWithRhwp(buf) {
  try {
    const rhwp = await loadRhwp();
    if (!rhwp) return '[rhwp 미로드]';
    // @rhwp/core API: new HwpDocument(Uint8Array)
    const HwpDocument = rhwp.HwpDocument || (rhwp.default && rhwp.default.HwpDocument);
    if (!HwpDocument) return '[rhwp HwpDocument 클래스 없음]';
    const doc = new HwpDocument(new Uint8Array(buf));
    const sections = doc.getSectionCount();
    const parts = [];
    for (let s = 0; s < sections; s++) {
      const paras = doc.getParagraphCount(s);
      for (let p = 0; p < paras; p++) {
        const len = doc.getParagraphLength(s, p);
        if (len > 0) {
          const t = doc.getTextRange(s, p, 0, len);
          if (t) parts.push(t);
        }
      }
    }
    return parts.join('\n');
  } catch (e) {
    return `[HWP 추출 실패: ${e.message}]`;
  }
}

export async function extractText(buf, filename) {
  const ext = path.extname(filename || '').toLowerCase();
  if (ext === '.pdf') return await extractPdf(buf);
  if (ext === '.hwp' || ext === '.hwpx') return await extractHwpWithRhwp(buf);
  return '';
}

// 다운받은 파일들 → 결합 텍스트
// PDF 가 추출되면 그것만 사용 (.hwp 와 중복이라)
export async function combineTexts(files) {
  const pdfParts = [];
  const hwpParts = [];
  for (const f of files) {
    const ext = path.extname(f.name || '').toLowerCase();
    if (!['.pdf', '.hwp', '.hwpx'].includes(ext)) continue;
    const t = await extractText(f.bytes, f.name);
    if (!t || t.startsWith('[')) continue;
    const block = `\n\n=== ${f.name} ===\n\n${t}`;
    if (ext === '.pdf') pdfParts.push(block);
    else hwpParts.push(block);
  }
  return pdfParts.length ? pdfParts.join('') : hwpParts.join('');
}
