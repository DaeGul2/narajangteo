// 메일플러그 출퇴근 엑셀의 "근무 상태" 컬럼을 정규화 sub-item 배열로 분리.
//
// 입력 예:
//   "외근 (09:00 AM ~ 06:00 PM)"
//   "반차-오전 (오전)\n반의반차-반반차 (01:00 PM ~ 03:00 PM)"   ← 줄바꿈 = 복합
//   "출장 (11-09 (일) ~ 11-14 (금))"
//   "-"  / "" / null
//
// 출력 예:
//   [{ itemIndex, category, subType?, rangeType?, startTime?, endTime?,
//      startDate?, endDate?, durationMinutes?, raw }, ...]
//
// 카테고리 enum: 종일 / 반차 / 반의반차 / 외근 / 재택근무 / 출장 / 연장근로 /
//                겨울방학 / 여름방학 / 경조휴가 / 유급기타휴가 / 무급기타휴가 / 병가 / 연차 / 기타 / 없음

const TIME_RE = /\((\d{1,2}:\d{2})\s*(AM|PM)\s*~\s*(\d{1,2}:\d{2})\s*(AM|PM)\)/i;
const DATE_RE = /\((\d{2}-\d{2})\s*\(.\)\s*~\s*(\d{2}-\d{2})\s*\(.\)\)/;

function to24h(hhmm, ampm) {
  if (!hhmm) return null;
  const [hStr, mStr] = hhmm.split(':');
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const isPM = /PM/i.test(ampm || '');
  if (h === 12 && !isPM) h = 0;
  else if (h < 12 && isPM) h += 12;
  return { h, m };
}
function diffMinutes(t1, t2) {
  if (!t1 || !t2) return null;
  let mins = (t2.h * 60 + t2.m) - (t1.h * 60 + t1.m);
  if (mins < 0) mins += 24 * 60; // 자정 넘김 보호
  return mins;
}

function classify(line) {
  const raw = String(line || '').trim();
  if (!raw || raw === '-') return null; // 없음 = 저장 안 함

  let category = '기타';
  let subType = null;

  if (/^종일/.test(raw))      category = '종일';
  else if (/^반차-오전/.test(raw)) { category = '반차'; subType = 'AM'; }
  else if (/^반차-오후/.test(raw)) { category = '반차'; subType = 'PM'; }
  else if (/^반의반차/.test(raw)) category = '반의반차';
  else if (/^외근/.test(raw))     category = '외근';
  else if (/^재택근무/.test(raw)) category = '재택근무';
  else if (/^출장/.test(raw))     category = '출장';
  else if (/^연장근로/.test(raw)) category = '연장근로';
  else if (/^겨울방학/.test(raw)) category = '겨울방학';
  else if (/^여름방학/.test(raw)) category = '여름방학';
  else if (/^경조휴가/.test(raw)) category = '경조휴가';
  else if (/^유급기타휴가/.test(raw)) category = '유급기타휴가';
  else if (/^무급기타휴가/.test(raw)) category = '무급기타휴가';
  else if (/^병가/.test(raw))     category = '병가';
  else if (/^연차/.test(raw))     category = '연차';

  // 시간/날짜 범위 추출
  let rangeType = null;
  let startTime = null, endTime = null;
  let startDate = null, endDate = null;
  let durationMinutes = null;

  const mt = raw.match(TIME_RE);
  if (mt) {
    rangeType = 'time';
    const s = `${mt[1]} ${mt[2].toUpperCase()}`;
    const e = `${mt[3]} ${mt[4].toUpperCase()}`;
    startTime = s; endTime = e;
    durationMinutes = diffMinutes(to24h(mt[1], mt[2]), to24h(mt[3], mt[4]));
  } else {
    const md = raw.match(DATE_RE);
    if (md) {
      rangeType = 'date';
      startDate = md[1]; endDate = md[2];
    }
  }

  return { category, subType, rangeType, startTime, endTime, startDate, endDate, durationMinutes, raw };
}

// 메인 — workStatus 셀(줄바꿈으로 복합 가능) → sub-item 배열
export function parseWorkStatus(cellValue) {
  const s = String(cellValue ?? '');
  if (!s.trim()) return [];
  const lines = s.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    const cl = classify(lines[i]);
    if (cl) items.push({ itemIndex: items.length, ...cl });
  }
  return items;
}
