// 공휴일/휴무일 캘린더 — 달력 그리드 + 클릭으로 추가/삭제 + 재평가
import { useEffect, useMemo, useState } from 'react'
import { authFetch } from '../auth.js'

const DOW_LABELS = ['일', '월', '화', '수', '목', '금', '토']

function fmtDate(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function sameDate(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

const S = {
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, marginBottom: 14 },
  btn: { padding: '6px 12px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', cursor: 'pointer', color: '#0f172a' },
  primary: { padding: '6px 14px', fontSize: 13, border: 'none', borderRadius: 6, background: '#1d4ed8', color: '#fff', cursor: 'pointer', fontWeight: 600 },
  danger: { padding: '4px 10px', fontSize: 11, border: 'none', borderRadius: 6, background: '#dc2626', color: '#fff', cursor: 'pointer', fontWeight: 600 },
  ghost: { padding: '4px 10px', fontSize: 11, border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', cursor: 'pointer', color: '#0f172a' },
  monthTitle: { fontSize: 22, fontWeight: 700, color: '#0f172a', minWidth: 200, textAlign: 'center' },
}

export default function AttendanceHolidays() {
  const [holidays, setHolidays] = useState([])   // [{date, name, source, created_at}]
  const [cursor, setCursor] = useState(() => {
    const d = new Date(); d.setDate(1); return d
  })
  const [err, setErr] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [editDay, setEditDay] = useState(null)    // YYYY-MM-DD 선택된 날 (입력 모드)
  const [draftName, setDraftName] = useState('')
  const [dirty, setDirty] = useState(false)

  const load = async () => {
    try {
      const r = await authFetch('/api/admin/holidays')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setHolidays(j.items || [])
    } catch (e) { setErr(e.message) }
  }
  useEffect(() => { load() }, [])

  const holidayMap = useMemo(() => {
    const m = new Map()
    for (const h of holidays) m.set(String(h.date).slice(0, 10), h)
    return m
  }, [holidays])

  // 월 단위 6주 (42칸) 셀 생성
  const cells = useMemo(() => {
    const y = cursor.getFullYear(), m = cursor.getMonth()
    const first = new Date(y, m, 1)
    const start = new Date(first)
    start.setDate(start.getDate() - first.getDay())  // 일요일로 정렬
    const arr = []
    for (let i = 0; i < 42; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      arr.push(d)
    }
    return arr
  }, [cursor])

  const monthLabel = `${cursor.getFullYear()}년 ${cursor.getMonth() + 1}월`
  const nav = (delta) => {
    const d = new Date(cursor); d.setMonth(d.getMonth() + delta); setCursor(d)
  }
  const goToday = () => { const d = new Date(); d.setDate(1); setCursor(d); setEditDay(null) }

  const onCellClick = (d) => {
    const key = fmtDate(d)
    const exists = holidayMap.get(key)
    setErr(''); setOkMsg('')
    if (exists) {
      // 이미 있는 날 → 편집 모드 (이름 미리 채움)
      setEditDay(key); setDraftName(exists.name)
    } else {
      setEditDay(key); setDraftName('')
    }
  }
  const closeEdit = () => { setEditDay(null); setDraftName('') }

  const save = async () => {
    if (!editDay) return
    if (!draftName.trim()) { setErr('이름을 입력하세요'); return }
    setBusy(true); setErr(''); setOkMsg('')
    try {
      const r = await authFetch('/api/admin/holidays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: editDay, name: draftName.trim() }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setOkMsg(`${editDay} ${draftName.trim()} 저장`)
      closeEdit()
      setDirty(true)
      await load()
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }
  const remove = async () => {
    if (!editDay) return
    if (!confirm(`${editDay} 공휴일을 삭제할까요?`)) return
    setBusy(true); setErr(''); setOkMsg('')
    try {
      const r = await authFetch(`/api/admin/holidays/${editDay}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setOkMsg(`${editDay} 삭제`)
      closeEdit()
      setDirty(true)
      await load()
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }
  const recompute = async () => {
    if (!confirm('모든 출퇴근 record 를 다시 평가합니다. 수동수정(★)은 보존됩니다. 진행할까요?')) return
    setBusy(true); setErr(''); setOkMsg('')
    try {
      const r = await authFetch('/api/admin/attendance/recompute', { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setOkMsg(`재평가 ${j.updated}건 — 통과 ${j.stats.pass} / 지각 ${j.stats.late} / 주말·공휴일 ${j.stats.skip}`)
      setDirty(false)
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  const today = new Date()

  return (
    <div>
      <div className="page-head">
        <h2>공휴일 캘린더</h2>
        <div className="page-sub">평일 중 회사가 쉬는 날을 등록 — 등록일은 지각 평가에서 자동 skip</div>
      </div>

      {err && <div style={{ ...S.card, background: '#fef2f2', borderColor: '#fecaca', color: '#b91c1c', padding: 10 }}>{err}</div>}
      {okMsg && <div style={{ ...S.card, background: '#ecfdf5', borderColor: '#a7f3d0', color: '#065f46', padding: 10 }}>{okMsg}</div>}

      <div style={S.card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <button style={S.btn} onClick={() => nav(-12)}>«</button>
          <button style={S.btn} onClick={() => nav(-1)}>‹ 이전</button>
          <div style={S.monthTitle}>{monthLabel}</div>
          <button style={S.btn} onClick={() => nav(1)}>다음 ›</button>
          <button style={S.btn} onClick={() => nav(12)}>»</button>
          <button style={S.btn} onClick={goToday}>오늘</button>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: '#64748b' }}>등록 {holidays.length}건</span>
          {dirty && <span style={{ fontSize: 11, color: '#dc2626', fontWeight: 600 }}>변경됨 — 재평가 필요</span>}
          <button style={dirty ? S.primary : S.btn} onClick={recompute} disabled={busy}>
            {busy ? '...' : '재평가 실행'}
          </button>
        </div>

        {/* 요일 헤더 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
          {DOW_LABELS.map((d, i) => (
            <div key={d} style={{
              padding: 6, textAlign: 'center', fontWeight: 700, fontSize: 12,
              color: i === 0 ? '#dc2626' : i === 6 ? '#1d4ed8' : '#475569',
              background: '#f8fafc', borderRadius: 4,
            }}>{d}</div>
          ))}
        </div>

        {/* 날짜 그리드 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
          {cells.map((d, i) => {
            const inMonth = d.getMonth() === cursor.getMonth()
            const key = fmtDate(d)
            const hol = holidayMap.get(key)
            const dow = d.getDay()
            const isToday = sameDate(d, today)
            const isSelected = editDay === key
            const isWeekend = dow === 0 || dow === 6

            // 배경 결정 (우선순위: selected > holiday > weekend > normal)
            let bg = inMonth ? '#fff' : '#f8fafc'
            let border = '1px solid #e5e7eb'
            if (isSelected) { bg = '#dbeafe'; border = '2px solid #1d4ed8' }
            else if (hol) { bg = '#fee2e2'; border = '1px solid #fca5a5' }
            else if (isWeekend && inMonth) { bg = '#f3f4f6' }
            if (isToday && !isSelected) border = '2px solid #16a34a'

            return (
              <div
                key={i}
                onClick={() => onCellClick(d)}
                style={{
                  minHeight: 76, padding: 6, borderRadius: 6,
                  background: bg, border, cursor: 'pointer',
                  opacity: inMonth ? 1 : 0.45,
                  transition: 'background 0.1s',
                }}
              >
                <div style={{
                  fontSize: 13, fontWeight: 600,
                  color: hol ? '#b91c1c' : dow === 0 ? '#dc2626' : dow === 6 ? '#1d4ed8' : '#0f172a',
                  marginBottom: 4,
                }}>
                  {d.getDate()}
                  {isToday && <span style={{ marginLeft: 4, fontSize: 9, color: '#16a34a', fontWeight: 700 }}>오늘</span>}
                </div>
                {hol && (
                  <div style={{
                    fontSize: 10, color: '#991b1b', fontWeight: 600,
                    lineHeight: 1.3, wordBreak: 'keep-all',
                  }}>
                    {hol.name}
                    {hol.source === 'kr_default' && (
                      <span style={{ fontSize: 8, color: '#94a3b8', fontWeight: 400, marginLeft: 4 }}>(기본)</span>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* 편집 패널 */}
        {editDay && (
          <div style={{
            marginTop: 14, padding: 14, background: '#f0f9ff', border: '1px solid #93c5fd',
            borderRadius: 8,
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: '#1e3a8a' }}>
              {editDay} {holidayMap.get(editDay) ? '— 편집' : '— 신규 등록'}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                value={draftName}
                onChange={e => setDraftName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && save()}
                placeholder="공휴일/휴무일 이름 (예: 회사 창립기념일)"
                style={{
                  flex: 1, padding: '8px 10px', fontSize: 13,
                  border: '1px solid #d1d5db', borderRadius: 6, background: '#fff',
                }}
                autoFocus
              />
              <button style={S.primary} onClick={save} disabled={busy}>저장</button>
              {holidayMap.get(editDay) && (
                <button style={S.danger} onClick={remove} disabled={busy}>삭제</button>
              )}
              <button style={S.ghost} onClick={closeEdit}>닫기</button>
            </div>
            {holidayMap.get(editDay)?.source === 'kr_default' && (
              <div style={{ marginTop: 6, fontSize: 11, color: '#1e40af' }}>
                ℹ️ 기본 시드 공휴일 — 수정/삭제 시 회사 정책으로 덮어쓰기 됩니다.
              </div>
            )}
          </div>
        )}
      </div>

      {/* 변경 후 안내 */}
      {dirty && (
        <div style={{ ...S.card, background: '#fefce8', borderColor: '#fde68a' }}>
          <div style={{ fontSize: 13, color: '#854d0e' }}>
            공휴일이 변경되었습니다. 기존 출퇴근 record 에 반영하려면 위쪽 <strong>"재평가 실행"</strong> 을 눌러주세요.
            <br />
            <span style={{ fontSize: 11, color: '#a16207' }}>
              ※ 수동수정(★) 된 record 는 보존됩니다. 새 크롤은 자동으로 이 캘린더를 반영합니다.
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
