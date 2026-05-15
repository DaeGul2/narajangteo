// 실험실 — hwp/hwpx 업로드 binary를 "페이지" 단위로 분할
//
// HWP 포맷은 물리적 페이지 개념이 명확하지 않다 (렌더링 시 결정).
// 전략:
//   - 섹션이 2개 이상이면 섹션을 페이지로 매핑 (unit='section')
//   - 섹션 1개면 문단을 PARA_PER_CHUNK 개씩 청크로 분할 (unit='chunk')

import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const PARA_PER_CHUNK = 25;

// @rhwp/core 는 WASM 패키지.
//   - default export 는 __wbg_init (WASM 초기화 함수)
//   - HwpDocument 는 named export
//   - 브라우저 기준 fetch(file://) 가 Node 에서 안 되므로
//     wasm 바이너리를 직접 읽어 init 에 넘겨준다.
let _rhwpModule = null;
async function loadRhwp() {
  if (_rhwpModule) return _rhwpModule;
  const mod = await import('@rhwp/core');
  const require = createRequire(import.meta.url);
  const wasmPath = require.resolve('@rhwp/core/rhwp_bg.wasm');
  const wasmBytes = fs.readFileSync(wasmPath);
  await mod.default(wasmBytes);
  _rhwpModule = mod;
  return _rhwpModule;
}

function firstNonEmpty(arr) {
  for (const s of arr) {
    const t = (s || '').trim();
    if (t) return t.slice(0, 60);
  }
  return '';
}

export async function parsePages(buf, filename) {
  const ext = path.extname(filename || '').toLowerCase();
  if (ext !== '.hwp' && ext !== '.hwpx') {
    throw new Error('.hwp / .hwpx 파일만 지원합니다');
  }
  const rhwp = await loadRhwp();
  const { HwpDocument } = rhwp;
  if (!HwpDocument) throw new Error('@rhwp/core HwpDocument 클래스 로드 실패');

  const doc = new HwpDocument(new Uint8Array(buf));
  const secs = doc.getSectionCount();

  // 섹션 × 문단 텍스트 수집
  const sectionParas = [];
  for (let s = 0; s < secs; s++) {
    const paras = doc.getParagraphCount(s);
    const arr = [];
    for (let p = 0; p < paras; p++) {
      const len = doc.getParagraphLength(s, p);
      const t = len > 0 ? doc.getTextRange(s, p, 0, len) : '';
      arr.push(t || '');
    }
    sectionParas.push(arr);
  }

  let pages = [];

  if (secs >= 2) {
    sectionParas.forEach((paras, idx) => {
      const text = paras.filter(Boolean).join('\n').trim();
      pages.push({
        index: idx + 1,
        title: firstNonEmpty(paras) || `섹션 ${idx + 1}`,
        text,
        unit: 'section',
      });
    });
  } else {
    const all = sectionParas[0] || [];
    for (let i = 0, page = 1; i < all.length; i += PARA_PER_CHUNK, page++) {
      const chunk = all.slice(i, i + PARA_PER_CHUNK);
      const text = chunk.filter(Boolean).join('\n').trim();
      if (!text) continue;
      pages.push({
        index: page,
        title: firstNonEmpty(chunk) || `페이지 ${page}`,
        text,
        unit: 'chunk',
      });
    }
  }

  pages = pages
    .filter(p => p.text.length > 0)
    .map((p, i) => ({ ...p, index: i + 1 }));

  return pages;
}
