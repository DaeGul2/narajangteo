// 지각 판단 룰 v1 (최종) — 출퇴근관리/룰/rule_v1.md
//
// 우선순위: 휴가 → 근무유형 → 출근내역
// 무시 카테고리: 재택(D, E), 연장근로(I)
//
// 입력:
//   - check_in_time: "HH:MM:SS AM/PM" 또는 ""/"-"/null
//   - items: parseWorkStatus() 결과 배열
//   - date: "YYYY-MM-DD (요일)" (v1 미사용)
// 출력:
//   { pass: boolean, reason, deadline, caseId, codes }

// ───────── time parsing ─────────
function parseTimeToSec(s) {
  if (!s || s === '-' || !String(s).trim()) return null;
  const m = String(s).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const ss = m[3] ? parseInt(m[3], 10) : 0;
  const ampm = (m[4] || '').toUpperCase();
  if (ampm === 'AM' && h === 12) h = 0;
  else if (ampm === 'PM' && h !== 12) h += 12;
  return h * 3600 + mm * 60 + ss;
}
function secToHHMMSS(s) {
  if (s == null) return '-';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

const SEC = {
  '09:30:59': 9 * 3600 + 30 * 60 + 59,
  '10:00:00': 10 * 3600,
  '11:30:59': 11 * 3600 + 30 * 60 + 59,
  '12:00:00': 12 * 3600,
  '14:00:00': 14 * 3600,
  '14:00:59': 14 * 3600 + 59,
  '16:00:59': 16 * 3600 + 59,
};

// ───────── 카테고리 → 코드 ─────────
function codeOf(item) {
  const c = item.category;
  if (c === '출장')   return item.rangeType === 'date' ? 'A' : item.rangeType === 'time' ? 'B' : '?';
  if (c === '종일')   return 'C';
  if (c === '재택근무') return item.rangeType === 'time' ? 'D' : item.rangeType === 'date' ? 'E' : '?';
  if (c === '유급기타휴가') return 'F';
  if (c === '외근')   return item.rangeType === 'time' ? 'G' : item.rangeType === 'date' ? 'H' : '?';
  if (c === '연장근로') return 'I';
  if (c === '반차')   return item.subType === 'AM' ? 'J' : item.subType === 'PM' ? 'K' : '?';
  if (c === '반의반차') return 'L';
  if (c === '무급기타휴가') return 'M';
  if (c === '경조휴가') return 'N';
  if (c === '겨울방학') return 'O';
  return '?';
}

// 휴가류 (0-1) — 카테고리 이름 직접 매칭 (실데이터 0건 카테고리 포함)
const HOLIDAY_CATS = new Set([
  '연차', '경조휴가', '유급기타휴가', '무급기타휴가',
  '겨울방학', '여름방학', '병가', '종일',
]);

function isL_0930_1130(l) {
  return l.startTime === '09:30 AM' && l.endTime === '11:30 AM';
}
function isL_1400_1600(l) {
  return l.startTime === '02:00 PM' && l.endTime === '04:00 PM';
}

function earliestStartSec(items) {
  let best = null;
  for (const it of items) {
    const s = parseTimeToSec(it.startTime);
    if (s == null) continue;
    if (best == null || s < best) best = s;
  }
  return best;
}

// 날짜 문자열에서 요일 추출 — "2026-04-24 (금)" → "금", fallback Date 파싱
function getDayOfWeek(dateStr) {
  const s = String(dateStr || '');
  const m = s.match(/\(([월화수목금토일])\)/);
  if (m) return m[1];
  const d = new Date(s.slice(0, 10) + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  return ['일','월','화','수','목','금','토'][d.getDay()];
}
function isWeekend(dateStr) {
  const dow = getDayOfWeek(dateStr);
  return dow === '토' || dow === '일';
}

function judgeArrival(checkInSec, deadlineSec, reason, deadlineLabel, caseId) {
  if (checkInSec == null) {
    return { pass: false, reason: `${reason} — 출근 내역 없음 (deadline=${deadlineLabel})`, deadline: deadlineLabel, caseId };
  }
  if (checkInSec <= deadlineSec) {
    return { pass: true, reason: `${reason} — ${secToHHMMSS(checkInSec)} ≤ ${deadlineLabel}`, deadline: deadlineLabel, caseId };
  }
  return { pass: false, reason: `${reason} — ${secToHHMMSS(checkInSec)} > ${deadlineLabel}`, deadline: deadlineLabel, caseId };
}

// ───────── 메인 ─────────
//   holidays: Map<"YYYY-MM-DD", "공휴일명"> 또는 undefined
export function judgeV1({ check_in_time, items, date, holidays }) {
  // 0) 주말(토/일) 스킵 — 평가하지 않음
  if (isWeekend(date)) {
    return { pass: null, skip: true, reason: '주말', deadline: null, caseId: 'weekend', codes: [] };
  }
  // 0-bis) 공휴일 스킵
  if (holidays) {
    const ymd = String(date || '').slice(0, 10);
    const name = holidays.get ? holidays.get(ymd) : (holidays[ymd] || null);
    if (name) {
      return { pass: null, skip: true, reason: `공휴일 — ${name}`, deadline: null, caseId: 'holiday', codes: [] };
    }
  }

  const checkInSec = parseTimeToSec(check_in_time);

  // 1) D/E/I 무시 + ? 코드도 무시
  const filtered = items.filter(it => {
    const c = codeOf(it);
    return c !== 'D' && c !== 'E' && c !== 'I' && c !== '?';
  });
  const coded = filtered.map(it => ({ ...it, code: codeOf(it) }));
  const codes = new Set(coded.map(c => c.code));
  const has = (c) => codes.has(c);
  const get = (c) => coded.filter(x => x.code === c);
  const ls = get('L');
  const codeList = [...codes];

  const mkResult = (r) => ({ ...r, codes: codeList });

  // ─ (0-1) 휴가류 무조건 통과 ─
  for (const it of coded) {
    if (HOLIDAY_CATS.has(it.category)) {
      return mkResult({ pass: true, reason: `${it.category} = 무조건 통과`, deadline: null, caseId: `0-1_${it.category}` });
    }
  }

  // ─ (0-2) J + K ─
  if (has('J') && has('K')) {
    return mkResult({ pass: true, reason: '오전반차+오후반차 = 종일', deadline: null, caseId: '0-2' });
  }

  // ─ (7) J + L + (B/G/A/H) ─
  if (has('J') && has('L') && (has('B') || has('G') || has('A') || has('H'))) {
    return mkResult({ pass: true, reason: '오전반차+반의반차+외근/출장', deadline: null, caseId: '7' });
  }
  // ─ (11) K + L + (B/G/A/H) ─
  if (has('K') && has('L') && (has('B') || has('G') || has('A') || has('H'))) {
    return mkResult({ pass: true, reason: '오후반차+반의반차+외근/출장', deadline: null, caseId: '11' });
  }

  // ─ L 단독 ─
  if (has('L') && !has('J') && !has('K') && !has('B') && !has('G') && !has('A') && !has('H')) {
    if (ls.some(isL_0930_1130)) {
      return mkResult(judgeArrival(checkInSec, SEC['11:30:59'], '반의반차(09:30~11:30) 단독', '11:30:59', 'L_solo_0930'));
    }
    return mkResult(judgeArrival(checkInSec, SEC['09:30:59'], '반의반차(그 외) 단독', '09:30:59', '1'));
  }

  // ─ (2) L + (B/G/A/H) (J/K 없음) ─
  if (has('L') && (has('B') || has('G') || has('A') || has('H')) && !has('J') && !has('K')) {
    if (ls.some(isL_0930_1130)) {
      if (has('A') || has('H')) {
        return mkResult({ pass: true, reason: '반의반차(09:30~11:30) + 외근/출장(D)', deadline: null, caseId: '2-1' });
      }
      const bg = [...get('B'), ...get('G')];
      const earliest = earliestStartSec(bg);
      if (earliest != null && earliest <= SEC['12:00:00']) {
        return mkResult({ pass: true, reason: '반의반차(09:30~11:30) + B/G(T) start ≤ 12:00', deadline: null, caseId: '2-2-1' });
      }
      return mkResult(judgeArrival(checkInSec, SEC['11:30:59'], '반의반차(09:30~11:30) + B/G(T) > 12:00', '11:30:59', '2-2-2'));
    }
    // L 그 외 + 외근/출장
    if (has('A') || has('H')) {
      return mkResult({ pass: true, reason: '반의반차(그 외) + 외근/출장(D)', deadline: null, caseId: '2-fb-D' });
    }
    return mkResult(judgeArrival(checkInSec, SEC['09:30:59'], '반의반차(그 외) + B/G [fallback]', '09:30:59', '2-fb-T'));
  }

  // ─ (3=9) / (10) L + K (J/B/G/A/H 없음) ─
  if (has('L') && has('K') && !has('J') && !has('B') && !has('G') && !has('A') && !has('H')) {
    if (ls.some(isL_0930_1130)) {
      return mkResult(judgeArrival(checkInSec, SEC['11:30:59'], '반의반차(09:30~11:30) + 오후반차', '11:30:59', '3'));
    }
    return mkResult(judgeArrival(checkInSec, SEC['09:30:59'], '오후반차 + 반의반차(그 외)', '09:30:59', '10'));
  }

  // ─ (5)/(6) J + L (K/B/G/A/H 없음) ─
  if (has('J') && has('L') && !has('K') && !has('B') && !has('G') && !has('A') && !has('H')) {
    if (ls.some(isL_1400_1600)) {
      return mkResult(judgeArrival(checkInSec, SEC['16:00:59'], '오전반차 + 반의반차(14:00~16:00)', '16:00:59', '5'));
    }
    return mkResult(judgeArrival(checkInSec, SEC['14:00:59'], '오전반차 + 반의반차(그 외)', '14:00:59', '6'));
  }

  // ─ (4) J + (B/G/A/H) (K/L 없음) ─
  if (has('J') && (has('B') || has('G') || has('A') || has('H')) && !has('K') && !has('L')) {
    if (checkInSec != null && checkInSec <= SEC['14:00:59']) {
      return mkResult({ pass: true, reason: `오전반차+외근/출장 출근 ${secToHHMMSS(checkInSec)} ≤ 14:00:59`, deadline: '14:00:59', caseId: '4-1' });
    }
    if (has('A') || has('H')) {
      return mkResult({ pass: true, reason: '오전반차+외근/출장(D)', deadline: null, caseId: '4-2-1' });
    }
    const bg = [...get('B'), ...get('G')];
    const earliest = earliestStartSec(bg);
    if (earliest != null && earliest <= SEC['14:00:00']) {
      return mkResult({ pass: true, reason: '오전반차+B/G(T) start ≤ 14:00', deadline: null, caseId: '4-2-2-1' });
    }
    return mkResult(judgeArrival(checkInSec, SEC['14:00:59'], '오전반차+B/G(T) > 14:00', '14:00:59', '4-2-2-2'));
  }

  // ─ (8) K + (B/G/A/H) (J/L 없음) ─
  if (has('K') && (has('B') || has('G') || has('A') || has('H')) && !has('J') && !has('L')) {
    if (checkInSec != null && checkInSec <= SEC['09:30:59']) {
      return mkResult({ pass: true, reason: `오후반차+외근/출장 출근 ${secToHHMMSS(checkInSec)} ≤ 09:30:59`, deadline: '09:30:59', caseId: '8-1' });
    }
    if (has('A') || has('H')) {
      return mkResult({ pass: true, reason: '오후반차+외근/출장(D)', deadline: null, caseId: '8-2-1' });
    }
    const bg = [...get('B'), ...get('G')];
    const earliest = earliestStartSec(bg);
    if (earliest != null && earliest <= SEC['10:00:00']) {
      return mkResult({ pass: true, reason: '오후반차+B/G(T) start ≤ 10:00', deadline: null, caseId: '8-2-2-1' });
    }
    return mkResult(judgeArrival(checkInSec, SEC['09:30:59'], '오후반차+B/G(T) > 10:00', '09:30:59', '8-2-2-2'));
  }

  // ─ J 단독 ─
  if (has('J') && coded.length === get('J').length) {
    return mkResult(judgeArrival(checkInSec, SEC['14:00:59'], '오전반차 단독', '14:00:59', 'J_solo'));
  }
  // ─ K 단독 ─
  if (has('K') && coded.length === get('K').length) {
    return mkResult(judgeArrival(checkInSec, SEC['09:30:59'], '오후반차 단독', '09:30:59', 'K_solo'));
  }

  // ─ (12) 휴가/반차 없고 외근/출장만 ─
  if ((has('A') || has('H') || has('B') || has('G')) && !has('J') && !has('K') && !has('L')) {
    if (has('A') || has('H')) {
      return mkResult({ pass: true, reason: '외근/출장(D) 단독', deadline: null, caseId: '12-1' });
    }
    const bg = [...get('B'), ...get('G')];
    const earliest = earliestStartSec(bg);
    if (earliest != null && earliest <= SEC['10:00:00']) {
      return mkResult({ pass: true, reason: '외근/출장(T) start ≤ 10:00', deadline: null, caseId: '12-2-1' });
    }
    return mkResult(judgeArrival(checkInSec, SEC['09:30:59'], '외근/출장(T) > 10:00', '09:30:59', '12-2-2'));
  }

  // ─ (13) 다 없음 ─
  return mkResult(judgeArrival(checkInSec, SEC['09:30:59'], '근무상태 없음', '09:30:59', '13'));
}

export { parseTimeToSec, codeOf };
