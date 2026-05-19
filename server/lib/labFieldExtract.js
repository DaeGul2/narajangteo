// 실험실 — hwp 트리에서 "라벨-값" 필드 후보를 자동 추출
//
// 휴리스틱:
//   1) 표 셀 중 텍스트가 라벨처럼 보이면 (사전 매치 / 콜론 끝 / 짧고 명사형)
//   2) 같은 row 의 다음 col(들) 의 첫 번째 비-라벨 셀 = 값 셀
//   3) 값 셀의 첫 paragraph 를 치환 target 으로 잡는다
//
// 라벨 사전은 우리 양식들에서 본 것들 + 일반적인 양식 라벨.

const KNOWN_LABELS = [
  // 인적정보
  '분야', '직위', '직책', '성명', '이름', '성 명', '전공',
  '학력', '최종학력', '자격증', '연락처', '이메일', '주소',
  '출생년월', '생년월일', '생 년 월 일', '나이', '성별',
  '소속', '소속회사', '소속기관', '부서', '담당업무',
  // 본 사업
  '투입기간', '투입율', '투입률', '담당 업무', '본 사업 수행정보',
  '해당분야 근무경력', '해당분야근무경력', '근무경력', '경력', '총 경력',
  // 유사사업 표 헤더 (column header)
  '사 업 명', '사업명', '참여기간', '참여당시 / 소속회사',
  '참여당시/소속회사', '참여당시소속회사', '참여당시 소속회사',
  '참여당시', '소속회사', '발주처', '발주기관',
  // 학력/경력 표 헤더
  '학교명', '학교', '재학기간', '재 학 기 간',
  '회사명', '회사', '기간', '시작일', '종료일',
  // 기타
  '날짜', '작성일', '제출일', '제안일', '비고',
];

function normalize(s) {
  return String(s || '').replace(/\s+/g, '').trim();
}
const KNOWN_NORM = new Set(KNOWN_LABELS.map(normalize));

function looksLikeLabel(text) {
  if (!text) return false;
  const t = String(text).trim();
  if (!t || t.length > 16) return false;
  // 콜론으로 끝나면 라벨
  if (/[:：]\s*$/.test(t)) return true;
  // 사전 정확 매치
  if (KNOWN_NORM.has(normalize(t))) return true;
  return false;
}

// 값 셀의 텍스트 — 너무 길거나 줄바꿈이면 multi-line 데이터일 가능성 ↑.
// 그래도 일단 필드 후보로는 잡는다. 사용자가 X 로 빼면 됨.
function joinCellText(cell) {
  return (cell.paragraphs || []).map(p => p.text || '').join('\n').trim();
}

// 표 분류:
//   "list 표" = row 0 의 모든 셀이 라벨처럼 보임 (유사사업 이력처럼 column-header 스타일).
//     → row 1+ 가 N 개의 동적 데이터 행. 단일 필드로 추출하면 안 됨 → skip.
//   "form 표" = row 0 에 라벨/값이 섞여 있음 (인적정보 표처럼 row-wise label-value).
//     → 필드 추출 대상.
function isListTable(ctl) {
  const row0 = ctl.cells.filter(c => c.row === 0);
  if (row0.length <= 1) return false;
  return row0.every(c => looksLikeLabel(joinCellText(c)));
}

// 라벨 → projects 키 자동 추론 사전 (List 표 column header 용).
// 키 의미:
//   project_name / agency / contract_amount / actual_amount / description
//   role / company_at_time / participation_rate
//   __period      = start_date ~ end_date 가공
//   __emp_position = 직원의 현재 position (참여 당시 직위 컬럼 없으므로 fallback)
const LIST_LABEL_TO_PROJECT = {
  '사 업 명': 'project_name', '사업명': 'project_name',
  '발주처': 'agency', '발주기관': 'agency',
  '참여기간': '__period', '기간': '__period',
  '담당업무': 'role', '담당 업무': 'role',
  '참여당시 / 소속회사': 'company_at_time',
  '참여당시/소속회사': 'company_at_time',
  '참여당시소속회사': 'company_at_time',
  '소속회사': 'company_at_time', '소속': 'company_at_time',
  '직위': '__emp_position', '직책': '__emp_position',
  '계약금액': 'contract_amount',
  '실적금액': 'actual_amount',
  '참여율': 'participation_rate', '투입률': 'participation_rate',
  '비고': 'description', '내용': 'description',
};

export function extractListTables(tree) {
  const tables = [];
  for (const sec of tree.sections) {
    for (const para of sec.paragraphs) {
      for (const ctl of para.controls) {
        if (ctl.type !== 'table') continue;
        if (!isListTable(ctl)) continue;

        // row 0 (헤더) — col 순으로 정렬
        const headerCells = ctl.cells
          .filter(c => c.row === 0)
          .sort((a, b) => (a.col ?? 0) - (b.col ?? 0));

        const headers = headerCells.map(hc => {
          const label = joinCellText(hc);
          const norm = normalize(label);
          const suggested =
            LIST_LABEL_TO_PROJECT[label] ||
            LIST_LABEL_TO_PROJECT[norm] || null;
          return {
            cellIndex: hc.cellIndex,
            col: hc.col,
            label,
            suggestedKey: suggested,
          };
        });

        // 데이터 row(row >= 1) 목록 — row 별로 col→cellIndex map
        const dataRowMap = new Map(); // row -> { col -> cell }
        for (const c of ctl.cells) {
          if (c.row == null || c.row < 1) continue;
          if (!dataRowMap.has(c.row)) dataRowMap.set(c.row, new Map());
          dataRowMap.get(c.row).set(c.col, c);
        }
        const dataRows = [...dataRowMap.entries()]
          .sort(([a], [b]) => a - b)
          .map(([row, colMap]) => ({
            row,
            cells: headers.map(h => {
              const cell = colMap.get(h.col);
              if (!cell) return null;
              const targetPara = cell.paragraphs[0];
              if (!targetPara) return null;
              return {
                col: h.col,
                cellIndex: cell.cellIndex,
                cellPara: targetPara.index,
                length: targetPara.length,
              };
            }),
          }));

        tables.push({
          id: `list:${sec.index}/${para.index}/${ctl.controlIndex}`,
          coord: {
            sec: sec.index,
            parentPara: para.index,
            controlIndex: ctl.controlIndex,
          },
          rows: ctl.rows,
          cols: ctl.cols,
          headers,
          dataRows,
          dataRowCount: dataRows.length,
        });
      }
    }
  }
  return tables;
}

export function extractFields(tree) {
  const fields = [];

  for (const sec of tree.sections) {
    for (const para of sec.paragraphs) {
      for (const ctl of para.controls) {
        if (ctl.type !== 'table') continue;

        // List 표(유사이력 등)는 전체 skip
        if (isListTable(ctl)) continue;

        // row 별 그룹화
        const byRow = new Map();
        for (const c of ctl.cells) {
          if (c.row == null) continue;
          if (!byRow.has(c.row)) byRow.set(c.row, []);
          byRow.get(c.row).push(c);
        }

        for (const [rowIdx, row] of byRow.entries()) {
          row.sort((a, b) => (a.col ?? 0) - (b.col ?? 0));

          for (let i = 0; i < row.length; i++) {
            const labelCell = row[i];
            const labelText = joinCellText(labelCell);
            if (!looksLikeLabel(labelText)) continue;

            // 라벨 다음 셀 = 값 셀 후보
            const valueCell = row[i + 1];
            if (!valueCell) continue;
            const valueText = joinCellText(valueCell);
            // 값 셀이 또 라벨이면 skip (라벨-라벨 연속 = 헤더 row)
            if (looksLikeLabel(valueText)) continue;

            // target = 값 셀의 첫 paragraph
            const targetPara = valueCell.paragraphs[0];
            if (!targetPara) continue;

            fields.push({
              id: `c:${sec.index}/${para.index}/${ctl.controlIndex}/${valueCell.cellIndex}/${targetPara.index}`,
              label: labelText,
              currentValue: valueText,
              // 좌표 — 그대로 applyOps 가 사용
              coord: {
                kind: 'cell',
                sec: sec.index,
                parentPara: para.index,
                controlIndex: ctl.controlIndex,
                cellIndex: valueCell.cellIndex,
                cellPara: targetPara.index,
                length: targetPara.length,
              },
              // 위치 메타 (UI 정렬용)
              context: {
                paraIndex: para.index,
                tableCtl: ctl.controlIndex,
                row: rowIdx,
                labelCol: labelCell.col,
                valueCol: valueCell.col,
              },
            });

            // 값 셀은 이미 쌍으로 잡혔으니 한 번 더 건너뜀
            i++;
          }
        }
      }
    }
  }

  return fields;
}
