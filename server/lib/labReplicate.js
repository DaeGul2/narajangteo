// 실험실 — 트리 + 직원 1명 데이터 → GPT 매핑 → 작업 적용 → exportHwp

import { openHwp, extractTree, extractTreeRange, applyOps, exportHwpBytes } from './labTree.js';
import { extractFields, extractListTables } from './labFieldExtract.js';
import pool from './db.js';

// 라벨 → employee 컬럼 자동 추론 (필드 모드에서 mapping.type='auto' 일 때)
const LABEL_TO_COLUMN = {
  '성명': 'name', '이름': 'name', '성 명': 'name',
  '직위': 'position', '직책': 'position',
  '전공': 'major',
  '학교': 'school', '학교명': 'school',
  '학력': 'final_edu', '최종학력': 'final_edu',
  '출생년월': 'birth_date', '생년월일': 'birth_date', '생 년 월 일': 'birth_date',
  '해당분야 근무경력': '해당분야_근무경력',
  '해당분야근무경력': '해당분야_근무경력',
  '근무경력': '해당분야_근무경력', '경력': '해당분야_근무경력',
};

// projects[i] 의 한 컬럼 값 — '__period' 같은 계산 키도 처리
function fmtYM(d) {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return '';
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${yy}.${mm}`;
}
function formatPeriod(s, e) {
  const a = fmtYM(s), b = fmtYM(e);
  if (a && b) return `${a}~ / ${b}`;
  if (a) return `${a}~`;
  if (b) return `~ ${b}`;
  return '';
}
function resolveProjectCell(key, project, employee) {
  if (!key) return null;
  if (key === '__period') return formatPeriod(project.start_date, project.end_date);
  if (key === '__emp_position') return employee.position || '';
  const v = project[key];
  if (v == null) return '';
  return String(v);
}

function resolveFieldValue(mapping, employee, label) {
  if (!mapping) return null;
  if (mapping.type === 'blank') return '';
  if (mapping.type === 'manual') return mapping.manualValue || '';
  if (mapping.type === 'column') {
    const v = employee[mapping.column];
    return v == null ? '' : String(v);
  }
  if (mapping.type === 'perEmployee') {
    const map = mapping.perEmployeeMap || {};
    const v = map[String(employee.id)] ?? map[employee.id];
    if (v == null) return null; // 입력 안 된 직원은 skip (그 셀은 원본 유지)
    return String(v);
  }
  if (mapping.type === 'auto') {
    const compact = String(label || '').replace(/\s+/g, '');
    const col = LABEL_TO_COLUMN[label] || LABEL_TO_COLUMN[compact];
    if (!col) return null; // 자동 추론 실패 — skip
    const v = employee[col];
    return v == null ? '' : String(v);
  }
  return null;
}

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
  // 유사사업 참여 이력 — 이 직원이 참여한 프로젝트 메타 + 본인 역할
  const [projects] = await pool.query(
    `SELECT
       p.name AS project_name, p.agency, p.start_date, p.end_date,
       p.contract_amount, p.actual_amount, p.description,
       ep.role, ep.company_at_time, ep.participation_rate
     FROM bid_employee_projects ep
     JOIN bid_projects p ON p.id = ep.project_id
     WHERE ep.employee_id = ?
     ORDER BY COALESCE(p.start_date, '0000-00-00') DESC, ep.id DESC`,
    [employeeId]
  );

  return {
    ...emp,
    educations: edus,
    careers,
    certifications: certs,
    projects, // 이 직원이 참여한 유사사업
    해당분야_근무경력: diffYearMonth(emp.external_join_date),
  };
}

const SYSTEM_PROMPT = `당신은 한글(.hwp) 양식 문서의 빈 칸 또는 예시 칸을 한 명의 직원 정보로 채우는 도구입니다.

[입력]
- nodes: 문서의 텍스트 노드 평탄화 리스트. 각 노드 = { id, text, row?, col? }
  - id가 "p:..." 로 시작 = 본문 문단
  - id가 "c:..." 로 시작 = 표 셀 안의 문단 (row/col 좌표 포함)
- employee: 한 명의 직원 데이터 (이름·직위·전공·경력·자격증·참여 프로젝트 등)
- 현재 처리 중인 직원의 이름은 USER 메시지에 명시됨
- instruction: 사용자가 "어떤 필드를 어떻게 바꿀지" 지시한 자연어

[출력 — JSON 만]
{ "ops": [ { "id": "<노드 id>", "newText": "<새 값>" }, ... ] }

[절대 규칙 — 어기면 결과가 망가집니다]
1. 라벨 노드는 **절대** 변경 금지. 라벨 = 짧고(주로 1~6자), 명사이고, 양식의 항목명인 셀.
   예: "분야", "직위", "성명", "전공", "자격증", "담당업무", "투입기간", "해당분야 근무경력",
       "사 업 명", "참여기간", "참여당시 / 소속회사", "발주처", "본 사업 수행정보"
2. **사용자 instruction 에서 변경하라고 명시한 필드만 변경한다.** instruction에 안 적힌 필드는 ops에 절대 포함하지 않는다 (현재 값이 무엇이든 그대로 둔다).
3. 변경 안 할 노드는 ops에서 **빼야 한다**. 같은 텍스트를 그대로 newText로 넣어서는 안 된다.
4. 라벨 셀 옆/아래의 데이터 셀에만 값을 넣는다. 라벨 셀의 id에 newText를 넣지 않는다.
5. instruction에 조건문이 있으면 (예: "민태희만 80%, 나머진 100%") 현재 직원 이름과 비교해서 해당하는 값을 사용한다.
6. employee에 해당 값이 없거나 instruction이 빈 값으로 두라 했으면 newText="" (빈 문자열)로.
7. 추측 금지. employee 데이터에 없는 정보는 채우지 않는다.

[작업 절차]
1) instruction을 분석해서 "변경할 필드 목록"을 만든다.
2) 노드 리스트에서 각 변경할 필드의 라벨 셀을 찾는다.
3) 그 라벨 셀과 같은 row 의 인접 cell(같은 row, 더 큰 col) 또는 바로 아래 셀이 데이터 셀이다.
4) **데이터 셀의 id 만** ops에 추가하고, newText는 employee 데이터로 결정한다.

[예시]
nodes 일부:
  { id: "c:0/4/0/0/0", text: "성명", row: 0, col: 5 }   ← 라벨
  { id: "c:0/4/0/1/0", text: "박하영", row: 0, col: 6 } ← 데이터
employee.name = "김응규", instruction = "이름을 바꿔라"
출력: { "ops": [ { "id": "c:0/4/0/1/0", "newText": "김응규" } ] }
주의: "c:0/4/0/0/0" (성명 라벨) 은 절대 ops에 안 들어감.`;

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

  const empName = employee.name || `직원 #${employee.id}`;
  const userMsg = `[현재 처리 중인 직원]
이름: ${empName}
※ 사용자 instruction에 다른 직원 이름이 언급된 조건문이 있다면, 현재 직원이 ${empName} 임을 기준으로 평가한다.

[직원 데이터]
\`\`\`json
${JSON.stringify(employee, null, 2).slice(0, 8000)}
\`\`\`

[사용자 instruction]
${instruction || '(빈 칸) — 사용자가 변경할 필드를 명시하지 않았으므로 ops 는 빈 배열을 반환하세요.'}

[노드 리스트 — id + 현재 text (+ 표 셀이면 row/col)]
\`\`\`json
${JSON.stringify(slim).slice(0, 60000)}
\`\`\`

instruction 에 명시된 필드만 변경. 그 외에는 손대지 않음. 라벨 셀 id 는 ops 에 절대 포함 금지.
JSON 만 반환:
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

      // 디버그 — 영역별 트리 비교용
      const paraNodes = nodes.filter(n => n.id.startsWith('p:')).length;
      const cellNodes = nodes.filter(n => n.id.startsWith('c:')).length;
      const tableCount = tree.sections[0].paragraphs.reduce(
        (s, p) => s + p.controls.filter(c => c.type === 'table').length, 0
      );
      console.log(
        `[replicate]   범위 #${i} [${range.startPara}..${range.endPara}] ` +
        `paragraphs=${range.endPara - range.startPara + 1} ` +
        `tables=${tableCount} para노드=${paraNodes} 셀노드=${cellNodes}`
      );
      if (tableCount === 0 && i > 0) {
        console.warn(`[replicate]   ⚠ ${empName}: paste된 영역에 표가 안 잡힘! ctlIndex 매칭 문제일 가능성.`);
      }
      // 처음 5개 노드 텍스트만 sample
      console.log(
        `[replicate]   샘플:`,
        nodes.slice(0, 5).map(n => `${n.id.slice(0, 18)}:"${(n.text || '').slice(0, 20)}"`).join(' | ')
      );

      log(`emp ${empName} tree`, {
        ms: Date.now() - tTree,
        paraCount: range.endPara - range.startPara + 1,
        nodes: nodes.length,
        tables: tableCount,
      });

      onProgress?.({
        current: i, total,
        currentName: `${empName} — GPT 호출중 (10~15초 소요)`,
        phase: 'mapping', stage: 'gpt',
      });
      const tGpt = Date.now();
      console.log(`[replicate] ▶ GPT 호출 시작 — ${empName} (nodes=${nodes.length})`);
      const gptOps = await generateOpsViaGpt({ nodes, employee: emp, instruction });
      const gptMs = Date.now() - tGpt;
      console.log(`[replicate] ◀ GPT 응답 — ${empName} ${(gptMs/1000).toFixed(1)}s, ops=${gptOps.length}`);
      log(`emp ${empName} GPT`, { ms: gptMs, ops: gptOps.length });

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

// 필드 모드 — GPT 우회. 사용자가 UI 에서 지정한 fields 매핑 그대로 적용.
// userFields = [{ removed, label, mapping: { type, column?, manualValue? } }, ...]
// 첫 영역의 필드 순서를 기준으로 각 영역에서 동일 인덱스의 필드를 매칭한다.
export async function replicateInOneFileByFields({ hwpBuf, employeeIds, userFields, userListTables, onProgress }) {
  const total = employeeIds.length;
  if (total === 0) throw new Error('직원이 없습니다');
  if (!Array.isArray(userFields) || userFields.length === 0) {
    throw new Error('필드 정보가 비어 있습니다');
  }

  const overallT0 = Date.now();
  const log = (msg, extra) => {
    const t = ((Date.now() - overallT0) / 1000).toFixed(2);
    console.log(`[byFields +${t}s] ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}`);
  };

  log('start', { total, userFieldCount: userFields.length });
  onProgress?.({ current: 0, total, currentName: 'hwp 로드중', phase: 'init', stage: 'openHwp' });
  const doc = await openHwp(hwpBuf);
  const SEC = 0;
  const origParaCount = doc.getParagraphCount(SEC);
  if (origParaCount <= 0) throw new Error('템플릿이 비어 있습니다');
  const origLastIdx = origParaCount - 1;
  const origLastOffset = doc.getParagraphLength(SEC, origLastIdx);

  doc.copySelection(SEC, 0, 0, origLastIdx, origLastOffset);

  const ranges = [{ startPara: 0, endPara: origLastIdx }];
  for (let i = 1; i < total; i++) {
    onProgress?.({
      current: i, total, currentName: `구조 복제 ${i}/${total - 1}`,
      phase: 'duplicating', stage: 'paste',
    });
    let cnt = doc.getParagraphCount(SEC);
    doc.insertParagraph(SEC, cnt);
    doc.insertParagraph(SEC, cnt + 1);
    const beforeCount = doc.getParagraphCount(SEC);
    const pasteAt = beforeCount - 1;
    doc.pasteInternal(SEC, pasteAt, 0);
    const afterCount = doc.getParagraphCount(SEC);
    ranges.push({ startPara: pasteAt, endPara: afterCount - 1 });
  }
  log('paste 시퀀스 완료', { ranges: ranges.length });

  const successNames = [];
  const failed = [];

  for (let i = 0; i < total; i++) {
    const empId = Number(employeeIds[i]);
    let empName = '';
    try {
      onProgress?.({
        current: i, total, currentName: `#${empId} 데이터 로드`, phase: 'mapping', stage: 'db',
      });
      const emp = await loadEmployee(empId);
      empName = emp.name || `직원 #${empId}`;

      onProgress?.({
        current: i, total, currentName: `${empName} 필드 매칭`, phase: 'mapping', stage: 'tree',
      });
      const range = ranges[i];
      const tree = await extractTreeRange(doc, SEC, range.startPara, range.endPara);
      const localFields = extractFields(tree);

      if (localFields.length !== userFields.length) {
        console.warn(
          `[byFields] 영역 ${i} 필드 개수 mismatch — ` +
          `local=${localFields.length} user=${userFields.length} (직원=${empName})`
        );
      }

      onProgress?.({
        current: i, total, currentName: `${empName} 적용`, phase: 'mapping', stage: 'apply',
      });
      const ops = [];
      const N = Math.min(localFields.length, userFields.length);
      let resolved = 0, skipped = 0;
      for (let j = 0; j < N; j++) {
        const u = userFields[j];
        if (u.removed) { skipped++; continue; }
        const local = localFields[j];
        const v = resolveFieldValue(u.mapping, emp, u.label);
        if (v == null) { skipped++; continue; }
        ops.push({
          op: 'replaceTextInCell',
          sec: local.coord.sec,
          parentPara: local.coord.parentPara,
          controlIndex: local.coord.controlIndex,
          cellIndex: local.coord.cellIndex,
          cellPara: local.coord.cellPara,
          offset: 0,
          length: local.coord.length,
          newText: v,
        });
        resolved++;
      }
      const { applied, failed: opFails } = applyOps(doc, ops);
      log(`emp ${empName}`, {
        resolved, skipped, applied: applied.length, opFails: opFails.length,
      });

      // ─── List 표 처리 (유사이력 등) ───
      if (Array.isArray(userListTables) && userListTables.length > 0) {
        const localLists = extractListTables(tree);
        const N_lists = Math.min(localLists.length, userListTables.length);

        for (let lt = 0; lt < N_lists; lt++) {
          const u = userListTables[lt];
          if (u.removed) continue;
          const local = localLists[lt];
          if (!local) continue;

          // user.headers 와 local.headers 는 동일 순서/길이를 가정 (같은 템플릿이라 paste 결과도 동일).
          // 템플릿 row 개수만큼만 채운다. 직원 projects 가 많으면 앞에서부터 N 개만, 적으면 남은 row 는 빈 칸.
          const projects = emp.projects || [];

          // 각 row 채우기
          const listOps = [];
          let listResolved = 0;
          for (let r = 0; r < local.dataRows.length; r++) {
            const project = projects[r];
            const row = local.dataRows[r];
            if (!project) {
              // 직원 프로젝트보다 row 가 많으면 빈 칸으로
              for (let h = 0; h < u.headers.length; h++) {
                const headerMapping = u.headers[h];
                if (!headerMapping || headerMapping.removed) continue;
                const cell = row.cells[h];
                if (!cell) continue;
                listOps.push({
                  op: 'replaceTextInCell',
                  sec: local.coord.sec,
                  parentPara: local.coord.parentPara,
                  controlIndex: local.coord.controlIndex,
                  cellIndex: cell.cellIndex,
                  cellPara: cell.cellPara,
                  offset: 0,
                  length: cell.length,
                  newText: '',
                });
              }
              continue;
            }
            for (let h = 0; h < u.headers.length; h++) {
              const headerMapping = u.headers[h];
              if (!headerMapping || headerMapping.removed) continue;
              const key = headerMapping.key;
              if (!key) continue;
              const cell = row.cells[h];
              if (!cell) continue;
              const v = resolveProjectCell(key, project, emp);
              if (v == null) continue;
              listOps.push({
                op: 'replaceTextInCell',
                sec: local.coord.sec,
                parentPara: local.coord.parentPara,
                controlIndex: local.coord.controlIndex,
                cellIndex: cell.cellIndex,
                cellPara: cell.cellPara,
                offset: 0,
                length: cell.length,
                newText: v,
              });
              listResolved++;
            }
          }
          const listApply = applyOps(doc, listOps);
          log(`emp ${empName} list#${lt}`, {
            projects: projects.length,
            rows: local.dataRows.length,
            resolved: listResolved,
            applied: listApply.applied.length,
            opFails: listApply.failed.length,
          });
        }
      }

      successNames.push(empName);
      onProgress?.({
        current: i + 1, total, currentName: empName, phase: 'mapping', stage: 'done',
      });
    } catch (e) {
      failed.push({ employeeId: empId, name: empName, error: e.message });
      console.error(`[byFields] ${empName || '#' + empId} 실패:`, e.message);
      onProgress?.({
        current: i + 1, total,
        currentName: `${empName || '#' + empId} (실패)`, phase: 'mapping', stage: 'fail',
      });
    }
  }

  onProgress?.({ current: total, total, currentName: 'hwp 저장중', phase: 'exporting' });
  const hwpBytes = exportHwpBytes(doc);
  log('=== 완료', { totalSec: ((Date.now() - overallT0) / 1000).toFixed(2) });
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
