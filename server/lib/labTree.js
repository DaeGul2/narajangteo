// 실험실 — @rhwp/core 로 .hwp 트리 직렬화/재조립
//
// 트리 구조 (JSON):
//   {
//     sections: [
//       {
//         index: 0,
//         paragraphs: [
//           {
//             index: 0,
//             text: "이력서",
//             length: 3,
//             controls: [  // 그 문단 안의 표/이미지 등
//               {
//                 controlIndex: 0,
//                 type: "table",
//                 rows: 5, cols: 3,
//                 cells: [
//                   {
//                     cellIndex: 0, row: 0, col: 0,
//                     paragraphs: [{ index: 0, text: "이름", length: 2 }]
//                   },
//                   ...
//                 ]
//               }
//             ]
//           },
//           ...
//         ]
//       }
//     ]
//   }
//
// 좌표(sec, para, cellIdx, cellPara, charOffset, length) 만 가지고 있으면
// rhwp 의 replaceText / insertTextInCell / replaceAll 로 그 위치를 정확히
// 찍어서 수정할 수 있다.

import fs from 'node:fs';
import { createRequire } from 'node:module';

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

// hwp 바이트 → 새 HwpDocument 인스턴스
export async function openHwp(hwpBuf) {
  const rhwp = await loadRhwp();
  const { HwpDocument } = rhwp;
  if (!HwpDocument) throw new Error('@rhwp/core HwpDocument 로드 실패');
  return new HwpDocument(new Uint8Array(hwpBuf));
}

function safeJson(s, fallback = null) {
  try { return JSON.parse(s); } catch { return fallback; }
}

function readParagraphText(doc, sec, para) {
  const len = doc.getParagraphLength(sec, para);
  if (len <= 0) return { text: '', length: 0 };
  const text = doc.getTextRange(sec, para, 0, len) || '';
  return { text, length: len };
}

function readCellParagraph(doc, sec, parentPara, ctl, cellIdx, cellPara) {
  const len = doc.getCellParagraphLength(sec, parentPara, ctl, cellIdx, cellPara);
  if (len <= 0) return { text: '', length: 0 };
  const text = doc.getTextInCell(sec, parentPara, ctl, cellIdx, cellPara, 0, len) || '';
  return { text, length: len };
}

// 문단의 컨트롤 인덱스를 0부터 시도해서 표/이미지를 찾는다.
// (getControlTextPositions 는 버전에 따라 무의미한 정수 배열을 돌려주므로 의존하지 않음.)
const MAX_CTLS_PER_PARA = 8;

function tryReadTable(doc, sec, parentPara, ctlIndex) {
  try {
    const raw = doc.getTableDimensions(sec, parentPara, ctlIndex);
    const dim = safeJson(raw, null);
    if (!dim) return null;
    const rows = dim.rowCount ?? 0;
    const cols = dim.colCount ?? 0;
    const cellCount = dim.cellCount ?? (rows * cols);
    if (rows <= 0 || cols <= 0 || cellCount <= 0) return null;
    return { rows, cols, cellCount };
  } catch {
    return null;
  }
}

function readTable(doc, sec, parentPara, ctlIndex, dim) {
  const { rows, cols, cellCount } = dim;
  const cells = [];
  for (let cellIdx = 0; cellIdx < cellCount; cellIdx++) {
    let cellInfo = {};
    try { cellInfo = safeJson(doc.getCellInfo(sec, parentPara, ctlIndex, cellIdx), {}) || {}; } catch {}
    const row = cellInfo.row ?? null;
    const col = cellInfo.col ?? null;
    const rowSpan = cellInfo.rowSpan ?? 1;
    const colSpan = cellInfo.colSpan ?? 1;

    let pCount = 0;
    try { pCount = doc.getCellParagraphCount(sec, parentPara, ctlIndex, cellIdx) || 0; } catch {}

    const paragraphs = [];
    for (let cp = 0; cp < pCount; cp++) {
      const { text, length } = readCellParagraph(doc, sec, parentPara, ctlIndex, cellIdx, cp);
      paragraphs.push({ index: cp, text, length });
    }
    cells.push({ cellIndex: cellIdx, row, col, rowSpan, colSpan, paragraphs });
  }
  return { rows, cols, cellCount, cells };
}

// 섹션의 일부 문단 범위만 추출 (paste 시 새 영역 매핑용)
export async function extractTreeRange(doc, sec, startPara, endPara) {
  const paragraphs = [];
  for (let p = startPara; p <= endPara; p++) {
    const { text, length } = readParagraphText(doc, sec, p);
    const controls = [];
    for (let ci = 0; ci < MAX_CTLS_PER_PARA; ci++) {
      const dim = tryReadTable(doc, sec, p, ci);
      if (!dim) continue;
      const tbl = readTable(doc, sec, p, ci, dim);
      controls.push({
        controlIndex: ci, type: 'table',
        rows: tbl.rows, cols: tbl.cols, cellCount: tbl.cellCount,
        cells: tbl.cells,
      });
    }
    paragraphs.push({ index: p, text, length, controls });
  }
  return { sections: [{ index: sec, paragraphs }] };
}

export async function extractTree(doc) {
  const secCount = doc.getSectionCount();
  const sections = [];

  for (let s = 0; s < secCount; s++) {
    const paraCount = doc.getParagraphCount(s);
    const paragraphs = [];

    for (let p = 0; p < paraCount; p++) {
      const { text, length } = readParagraphText(doc, s, p);

      // 컨트롤 인덱스 0..MAX_CTLS_PER_PARA-1 시도. 표가 발견되면 추가.
      const controls = [];
      for (let ci = 0; ci < MAX_CTLS_PER_PARA; ci++) {
        const dim = tryReadTable(doc, s, p, ci);
        if (!dim) continue;
        const tbl = readTable(doc, s, p, ci, dim);
        controls.push({
          controlIndex: ci,
          type: 'table',
          rows: tbl.rows,
          cols: tbl.cols,
          cellCount: tbl.cellCount,
          cells: tbl.cells,
        });
      }

      paragraphs.push({ index: p, text, length, controls });
    }
    sections.push({ index: s, paragraphs });
  }
  return { sections };
}

// 작업 리스트 적용. 좌표가 잘못된 op 는 조용히 건너뛰지 말고 명시적으로 실패시킨다
// (디버깅 가능하도록 op 정보 포함).
//
// 지원 op:
//   { op: 'replaceText', sec, para, offset, length, newText }
//   { op: 'replaceTextInCell', sec, parentPara, controlIndex, cellIndex, cellPara, offset, length, newText }
//   { op: 'replaceAll', query, newText, caseSensitive? }
export function applyOps(doc, ops) {
  const applied = [];
  const failed = [];
  for (const op of ops || []) {
    try {
      switch (op.op) {
        case 'replaceText':
          doc.replaceText(op.sec, op.para, op.offset, op.length, op.newText);
          applied.push(op);
          break;
        case 'replaceTextInCell': {
          if (op.length > 0) {
            doc.deleteTextInCell(
              op.sec, op.parentPara, op.controlIndex, op.cellIndex, op.cellPara,
              op.offset, op.length
            );
          }
          if (op.newText) {
            doc.insertTextInCell(
              op.sec, op.parentPara, op.controlIndex, op.cellIndex, op.cellPara,
              op.offset, op.newText
            );
          }
          applied.push(op);
          break;
        }
        case 'replaceAll':
          doc.replaceAll(op.query, op.newText, !!op.caseSensitive);
          applied.push(op);
          break;
        default:
          throw new Error(`unknown op: ${op.op}`);
      }
    } catch (e) {
      failed.push({ op, error: e.message });
    }
  }
  return { applied, failed };
}

export function exportHwpBytes(doc) {
  const bytes = doc.exportHwp();
  return Buffer.from(bytes);
}
