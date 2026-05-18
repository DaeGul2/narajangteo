// 실험실 — 트리 + 직원 1명 데이터 → GPT 매핑 → 작업 적용 → exportHwp

import { openHwp, extractTree, extractTreeRange, applyOps, exportHwpBytes } from './labTree.js';
import pool from './db.js';

// 트리를 GPT 가 다루기 쉬운 평탄한 노드 리스트로 변환.
// id 는 짧고 식별 가능해야 함. coord 는 실제 op 생성에 필요한 좌표.
//
// id 포맷:
//   p:<sec>/<para>           — 본문 문단
//   c:<sec>/<para>/<ctl>/<cell>/<cellPara>  — 표 셀 내 문단
function flattenTree(tree, { onlyNonEmpty = true } = {}) {
  const nodes = [];
  for (const s of tree.sections) {
    for (const p of s.paragraphs) {
      if (!onlyNonEmpty || (p.text && p.text.trim())) {
        nodes.push({
          id: `p:${s.index}/${p.index}`,
          text: p.text,
          coord: { kind: 'para', sec: s.index, para: p.index, length: p.length },
        });
      }
      for (const ctl of p.controls) {
        if (ctl.type !== 'table') continue;
        for (const cell of ctl.cells) {
          for (const cp of cell.paragraphs) {
            if (!onlyNonEmpty || (cp.text && cp.text.trim())) {
              nodes.push({
                id: `c:${s.index}/${p.index}/${ctl.controlIndex}/${cell.cellIndex}/${cp.index}`,
                text: cp.text,
                row: cell.row, col: cell.col,
                coord: {
                  kind: 'cell',
                  sec: s.index,
                  parentPara: p.index,
                  controlIndex: ctl.controlIndex,
                  cellIndex: cell.cellIndex,
                  cellPara: cp.index,
                  length: cp.length,
                },
              });
            }
          }
        }
      }
    }
  }
  return nodes;
}

// GPT 응답({id, newText}[])을 좌표 기반 op 로 변환
function idToOp(id, newText, coord) {
  if (!coord) return null;
  if (coord.kind === 'para') {
    return {
      op: 'replaceText',
      sec: coord.sec,
      para: coord.para,
      offset: 0,
      length: coord.length,
      newText: String(newText ?? ''),
    };
  }
  if (coord.kind === 'cell') {
    return {
      op: 'replaceTextInCell',
      sec: coord.sec,
      parentPara: coord.parentPara,
      controlIndex: coord.controlIndex,
      cellIndex: coord.cellIndex,
      cellPara: coord.cellPara,
      offset: 0,
      length: coord.length,
      newText: String(newText ?? ''),
    };
  }
  return null;
}

// 입사일 → "X년 Y개월" (오늘 기준). 일자 보정: 오늘 일 < 입사 일 이면 -1개월.
function diffYearMonth(from, to = new Date()) {
  if (!from) return null;
  const f = from instanceof Date ? from : new Date(from);
  if (isNaN(f.getTime())) return null;
  let years = to.getFullYear() - f.getFullYear();
  let months = to.getMonth() - f.getMonth();
  if (to.getDate() < f.getDate()) months -= 1;
  if (months < 0) { years -= 1; months += 12; }
  if (years < 0) return null;
  return `${years}년 ${months}개월`;
}

async function loadEmployee(employeeId) {
  const [[emp]] = await pool.query(
    `SELECT id, name, position, birth_date, final_edu, school, major,
            grad_year, grad_month, external_join_date, real_join_date
     FROM bid_employees WHERE id = ? AND active = 1`,
    [employeeId]
  );
  if (!emp) throw new Error(`직원(id=${employeeId}) 없음`);

  const [edus] = await pool.query(
    `SELECT degree, school, major, graduated_at, thesis
     FROM bid_employee_educations WHERE employee_id = ?
     ORDER BY sort_order, id`,
    [employeeId]
  );
  const [careers] = await pool.query(
    `SELECT org_name, start_date, end_date, position, duty
     FROM bid_employee_careers WHERE employee_id = ?
     ORDER BY sort_order, id`,
    [employeeId]
  );
  const [certs] = await pool.query(
    `SELECT name, acquired_at, issuer, cert_number
     FROM bid_employee_certifications WHERE employee_id = ?
     ORDER BY sort_order, id`,
    [employeeId]
  );
  return {
    ...emp,
    educations: edus,
    careers,
    certifications: certs,
    // 계산 필드 — 오늘 기준 외부용 입사일과의 차이
    해당분야_근무경력: diffYearMonth(emp.external_join_date),
  };
}

const SYSTEM_PROMPT =
  '당신은 한글(.hwp) 문서의 텍스트 노드를 직원 데이터로 채우는 작업을 합니다. ' +
  '사용자는 평탄화된 노드 리스트(각 노드에 id 와 현재 text 가 있음)와 한 명의 직원 DB 데이터를 줍니다. ' +
  '당신은 직원 데이터로 채워야 할 노드만 골라서 [{id, newText}] 형태로 반환합니다. ' +
  '규칙: ' +
  '(1) 라벨/머리글 노드(예: "이름", "출생년월", "학력") 는 절대 변경하지 않습니다 — 데이터 칸만 변경. ' +
  '(2) 데이터가 비어있는 경우 그 노드는 결과에서 제외합니다. ' +
  '(3) 직원 데이터에 해당 값이 없으면 그 노드는 결과에서 제외합니다 (추측 금지). ' +
  '(4) 표 셀의 row/col 정보를 참고해 라벨-값 쌍 관계를 파악합니다 (보통 같은 행에서 라벨 다음 칸이 값). ' +
  '(5) JSON 만 반환. 머리말·설명·코드블록 금지.';

export async function generateOpsViaGpt({ nodes, employee, instruction }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY 미설정');
  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

  // GPT 입력 토큰 보호 — 노드 텍스트는 60자로 자르고 좌표는 제거(서버가 id 매핑 보관)
  const slim = nodes.map(n => ({
    id: n.id,
    text: (n.text || '').slice(0, 80),
    ...(n.row != null ? { row: n.row, col: n.col } : {}),
  }));

  const userMsg = `[직원 데이터]
\`\`\`json
${JSON.stringify(employee, null, 2).slice(0, 8000)}
\`\`\`

[지시사항]
${instruction || '템플릿의 빈 칸 또는 예시 텍스트를 위 직원의 실제 정보로 채워주세요.'}

[노드 리스트 — id + 현재 text (+ 표 셀이면 row/col)]
\`\`\`json
${JSON.stringify(slim).slice(0, 60000)}
\`\`\`

위 노드 중 채워야 할 것만 골라 다음 형식으로 JSON 만 반환:
{ "ops": [ { "id": "...", "newText": "..." }, ... ] }`;

  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: key });
  const resp = await client.chat.completions.create({
    model,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMsg },
    ],
  });
  const raw = resp.choices?.[0]?.message?.content || '{}';
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) {
    throw new Error(`GPT JSON 파싱 실패: ${e.message} | raw=${raw.slice(0, 300)}`);
  }
  return Array.isArray(parsed.ops) ? parsed.ops : [];
}

// 단일 .hwp 안에 N명 차례로 — 템플릿 영역을 복제(paste)해서 같은 doc 안에 N벌 배치
// 후, 각 영역을 해당 직원 데이터로 매핑한다. 사람 사이는 빈 문단 2개(엔터 두 번) 구분.
//
// 부분 실패 허용 — 한 직원 매핑이 실패해도 그 영역은 미치환 상태로 남고 다음으로 진행.
//
// onProgress({ current, total, currentName, phase }) — phase: 'duplicating' | 'mapping'
export async function replicateInOneFile({ hwpBuf, employeeIds, instruction, onProgress }) {
  const total = employeeIds.length;
  if (total === 0) throw new Error('직원이 없습니다');

  const overallT0 = Date.now();
  const log = (msg, extra) => {
    const t = ((Date.now() - overallT0) / 1000).toFixed(2);
    console.log(`[replicate +${t}s] ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}`);
  };

  log('start', { total, instruction: instruction?.slice(0, 60) });
  onProgress?.({ current: 0, total, currentName: 'hwp 로드중', phase: 'init', stage: 'openHwp' });
  const tOpen = Date.now();
  const doc = await openHwp(hwpBuf);
  log('hwp 로드 완료', { ms: Date.now() - tOpen });

  const SEC = 0;
  const origParaCount = doc.getParagraphCount(SEC);
  if (origParaCount <= 0) throw new Error('템플릿이 비어 있습니다');
  const origLastIdx = origParaCount - 1;
  const origLastOffset = doc.getParagraphLength(SEC, origLastIdx);
  log('템플릿 크기', { origParaCount, origLastIdx, origLastOffset });

  const tCopy = Date.now();
  doc.copySelection(SEC, 0, 0, origLastIdx, origLastOffset);
  log('원본 copySelection', { ms: Date.now() - tCopy });

  const ranges = [{ startPara: 0, endPara: origLastIdx }];
  for (let i = 1; i < total; i++) {
    onProgress?.({
      current: i, total, currentName: `구조 복제 ${i}/${total - 1}`,
      phase: 'duplicating', stage: 'paste',
    });
    const tPaste = Date.now();
    let cnt = doc.getParagraphCount(SEC);
    doc.insertParagraph(SEC, cnt);
    doc.insertParagraph(SEC, cnt + 1);
    const beforeCount = doc.getParagraphCount(SEC);
    const pasteAt = beforeCount - 1;
    doc.pasteInternal(SEC, pasteAt, 0);
    const afterCount = doc.getParagraphCount(SEC);
    log(`paste #${i}`, { ms: Date.now() - tPaste, pasteAt, beforeCount, afterCount });
    ranges.push({ startPara: pasteAt, endPara: afterCount - 1 });
  }

  const successNames = [];
  const failed = [];

  for (let i = 0; i < total; i++) {
    const empId = Number(employeeIds[i]);
    let empName = '';
    const tEmp = Date.now();
    try {
      onProgress?.({
        current: i, total, currentName: `#${empId} 데이터 로드`, phase: 'mapping', stage: 'db',
      });
      const tDb = Date.now();
      const emp = await loadEmployee(empId);
      empName = emp.name || `직원 #${empId}`;
      log(`emp ${empName} DB`, { ms: Date.now() - tDb });

      onProgress?.({
        current: i, total, currentName: `${empName} 트리 추출`, phase: 'mapping', stage: 'tree',
      });
      const tTree = Date.now();
      const range = ranges[i];
      const tree = await extractTreeRange(doc, SEC, range.startPara, range.endPara);
      const nodes = flattenTree(tree, { onlyNonEmpty: true });
      const coordMap = new Map();
      for (const n of nodes) coordMap.set(n.id, n.coord);
      log(`emp ${empName} tree`, {
        ms: Date.now() - tTree,
        paraCount: range.endPara - range.startPara + 1,
        nodes: nodes.length,
      });

      onProgress?.({
        current: i, total, currentName: `${empName} GPT 호출중`, phase: 'mapping', stage: 'gpt',
      });
      const tGpt = Date.now();
      const gptOps = await generateOpsViaGpt({ nodes, employee: emp, instruction });
      log(`emp ${empName} GPT`, { ms: Date.now() - tGpt, ops: gptOps.length });

      onProgress?.({
        current: i, total, currentName: `${empName} 적용`, phase: 'mapping', stage: 'apply',
      });
      const tApply = Date.now();
      const realOps = [];
      for (const g of gptOps) {
        const c = coordMap.get(g.id);
        const op = idToOp(g.id, g.newText, c);
        if (op) realOps.push(op);
      }
      const { applied, failed: opFails } = applyOps(doc, realOps);
      log(`emp ${empName} apply`, {
        ms: Date.now() - tApply,
        applied: applied.length, opFails: opFails.length,
      });

      successNames.push(empName);
      log(`emp ${empName} 완료`, { totalMs: Date.now() - tEmp });
      onProgress?.({
        current: i + 1, total, currentName: empName, phase: 'mapping', stage: 'done',
      });
    } catch (e) {
      failed.push({ employeeId: empId, name: empName, error: e.message });
      log(`emp #${empId} 실패`, { error: e.message });
      onProgress?.({
        current: i + 1, total,
        currentName: `${empName || '#' + empId} (실패: ${e.message.slice(0, 40)})`,
        phase: 'mapping', stage: 'fail',
      });
    }
  }

  onProgress?.({ current: total, total, currentName: 'hwp 저장중', phase: 'exporting' });
  const tExport = Date.now();
  const hwpBytes = exportHwpBytes(doc);
  log('export', { ms: Date.now() - tExport, bytes: hwpBytes.length });
  log('=== 전체 완료', { totalSec: ((Date.now() - overallT0) / 1000).toFixed(2) });

  return { hwpBytes, successNames, failed };
}

// 메인 진입점 — 캐시된 hwpBuf 와 employeeId 로 .hwp Buffer 생성
export async function replicateForEmployee({ hwpBuf, employeeId, instruction }) {
  const doc = await openHwp(hwpBuf);
  const tree = await extractTree(doc);
  const nodes = flattenTree(tree, { onlyNonEmpty: true });

  // id → coord 맵
  const coordMap = new Map();
  for (const n of nodes) coordMap.set(n.id, n.coord);

  const employee = await loadEmployee(employeeId);
  const gptOps = await generateOpsViaGpt({ nodes, employee, instruction });

  const realOps = [];
  for (const g of gptOps) {
    const c = coordMap.get(g.id);
    const op = idToOp(g.id, g.newText, c);
    if (op) realOps.push(op);
  }

  const { applied, failed } = applyOps(doc, realOps);
  const hwpBytes = exportHwpBytes(doc);

  return {
    hwpBytes,
    summary: {
      nodeCount: nodes.length,
      gptOpsCount: gptOps.length,
      appliedCount: applied.length,
      failedCount: failed.length,
      failed: failed.slice(0, 10),
      employeeName: employee.name,
    },
  };
}
