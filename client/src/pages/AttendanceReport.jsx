// 출퇴근 리포트 — 기간 선택, 사람별 지각 통계, 드릴다운
import { useEffect, useMemo, useState } from 'react'
import { authFetch } from '../auth.js'

const CATEGORY_COLORS = {
  '외근':       '#1d4ed8', '출장':       '#0891b2', '재택근무':   '#7c3aed',
  '연장근로':   '#0f766e', '반차':       '#ea580c', '반의반차':   '#f59e0b',
  '종일':       '#64748b', '겨울방학':   '#0284c7', '여름방학':   '#dc2626',
  '경조휴가':   '#a16207', '유급기타휴가': '#9ca3af', '무급기타휴가': '#6b7280',
  '병가':       '#be123c', '연차':       '#16a34a', '기타':       '#94a3b8',
}

const S = {
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, marginBottom: 14 },
  bar: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  input: { padding: '6px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, background: '#fff' },
  btn: { padding: '6px 12px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', cursor: 'pointer', color: '#0f172a' },
  primary: { padding: '6px 14px', fontSize: 13, border: 'none', borderRadius: 6, background: '#1d4ed8', color: '#fff', cursor: 'pointer', fontWeight: 600 },
  statCard: { flex: 1, minWidth: 120, padding: 12, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 },
  statLabel: { fontSize: 11, color: '#64748b', marginBottom: 4 },
  statVal: { fontSize: 22, fontWeight: 700, color: '#0f172a' },
}

// "YYYY-MM-DD"
function fmtDate(d) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x }
function startOfWeek(d) { const x = new Date(d); const dow = x.getDay(); x.setDate(x.getDate() - ((dow + 6) % 7)); return x } // 월요일 시작
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1) }
function endOfMonth(d)   { return new Date(d.getFullYear(), d.getMonth() + 1, 0) }

function CategoryPill({ it }) {
  const color = CATEGORY_COLORS[it.category] || '#64748b'
  const extra =
    it.range_type === 'time' ? ` ${it.start_time}~${it.end_time}` :
    it.range_type === 'date' ? ` ${it.start_date}~${it.end_date}` :
    it.sub_type ? ` ${it.sub_type}` : ''
  return (
    <span style={{
      display: 'inline-block', padding: '1px 6px', borderRadius: 999,
      background: color + '20', color, border: `1px solid ${color}40`,
      fontSize: 10, fontWeight: 600, margin: '1px 2px',
    }}>{it.category}{extra}</span>
  )
}

function casePill(code, count) {
  return (
    <span key={code} style={{
      display: 'inline-block', padding: '2px 6px', borderRadius: 4,
      background: '#fef3c7', color: '#92400e',
      fontFamily: 'monospace', fontSize: 10, fontWeight: 600,
      marginRight: 4, marginBottom: 2,
    }}>{code}×{count}</span>
  )
}

export default function AttendanceReport() {
  // 기본: 최근 30일
  const todayD = new Date()
  const [from, setFrom] = useState(fmtDate(addDays(todayD, -29)))
  const [to, setTo] = useState(fmtDate(todayD))
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [expandId, setExpandId] = useState(null)  // 펼쳐진 employee_id

  const load = async (f = from, t = to) => {
    setBusy(true); setErr('')
    try {
      const r = await authFetch(`/api/admin/attendance/report?from=${f}&to=${t}`)
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error || `HTTP ${r.status}`)
      }
      setData(await r.json())
    } catch (e) { setErr(e.message); setData(null) }
    finally { setBusy(false) }
  }
  useEffect(() => { load() }, []) // 초기 1회

  const preset = (kind) => {
    const today = new Date()
    let f, t
    if (kind === 'thisWeek') {
      f = startOfWeek(today); t = addDays(f, 4) // 월~금
    } else if (kind === 'thisMonth') {
      f = startOfMonth(today); t = endOfMonth(today)
    } else if (kind === 'lastMonth') {
      const m = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      f = startOfMonth(m); t = endOfMonth(m)
    } else if (kind === '30d') {
      f = addDays(today, -29); t = today
    } else if (kind === '90d') {
      f = addDays(today, -89); t = today
    }
    const ff = fmtDate(f), tt = fmtDate(t)
    setFrom(ff); setTo(tt); load(ff, tt)
  }

  const exportCsv = () => {
    if (!data) return
    const lines = [['이름','직위','평가일','통과','지각','지각률(%)','수동수정','케이스 분포']]
    for (const p of data.peopleStats) {
      const cb = Object.entries(p.caseBreakdown).map(([k, n]) => `${k}×${n}`).join(';')
      const rate = p.evaluated ? (p.late / p.evaluated * 100).toFixed(1) : '0.0'
      lines.push([p.name, p.position || '', p.evaluated, p.pass, p.late, rate, p.override, cb])
    }
    const csv = '﻿' + lines.map(r => r.map(c => {
      const s = String(c ?? '')
      return /[,"\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s
    }).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `attendance_${from}_${to}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(a.href)
  }

  const caseList = useMemo(() => {
    if (!data?.caseDistribution) return []
    return Object.entries(data.caseDistribution).sort((a, b) => b[1] - a[1])
  }, [data])

  return (
    <div>
      <div className="page-head">
        <h2>출퇴근 리포트</h2>
        <div className="page-sub">기간 선택 · 사람별 지각 통계</div>
      </div>

      {/* 컨트롤 */}
      <div style={S.card}>
        <div style={S.bar}>
          <label style={{ fontSize: 13, color: '#475569' }}>기간</label>
          <input type="date" style={S.input} value={from} onChange={e => setFrom(e.target.value)} />
          <span style={{ color: '#94a3b8' }}>~</span>
          <input type="date" style={S.input} value={to} onChange={e => setTo(e.target.value)} />
          <button style={S.primary} onClick={() => load()} disabled={busy}>
            {busy ? '로딩…' : '조회'}
          </button>

          <span style={{ marginLeft: 12, fontSize: 11, color: '#94a3b8' }}>프리셋:</span>
          <button style={S.btn} onClick={() => preset('thisWeek')}>이번 주</button>
          <button style={S.btn} onClick={() => preset('thisMonth')}>이번 달</button>
          <button style={S.btn} onClick={() => preset('lastMonth')}>지난 달</button>
          <button style={S.btn} onClick={() => preset('30d')}>최근 30일</button>
          <button style={S.btn} onClick={() => preset('90d')}>최근 90일</button>

          <span style={{ flex: 1 }} />
          <button style={S.btn} onClick={exportCsv} disabled={!data}>CSV 내보내기</button>
        </div>
      </div>

      {err && <div style={{ ...S.card, background: '#fef2f2', borderColor: '#fecaca', color: '#b91c1c' }}>{err}</div>}

      {data && (
        <>
          {/* 요약 카드 */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            <div style={S.statCard}>
              <div style={S.statLabel}>총 평가 (사람 × 일)</div>
              <div style={S.statVal}>{data.totalEvaluated}</div>
            </div>
            <div style={S.statCard}>
              <div style={S.statLabel}>통과</div>
              <div style={{ ...S.statVal, color: '#166534' }}>{data.totalPass}</div>
            </div>
            <div style={S.statCard}>
              <div style={S.statLabel}>지각</div>
              <div style={{ ...S.statVal, color: '#b91c1c' }}>{data.totalLate}</div>
            </div>
            <div style={S.statCard}>
              <div style={S.statLabel}>주말/스킵</div>
              <div style={S.statVal}>{data.totalSkip}</div>
            </div>
            <div style={S.statCard}>
              <div style={S.statLabel}>수동 수정</div>
              <div style={{ ...S.statVal, color: '#f59e0b' }}>{data.totalOverride}</div>
            </div>
            <div style={S.statCard}>
              <div style={S.statLabel}>전체 지각률</div>
              <div style={{ ...S.statVal, color: data.totalEvaluated && (data.totalLate / data.totalEvaluated) > 0.1 ? '#b91c1c' : '#0f172a' }}>
                {data.totalEvaluated ? (data.totalLate / data.totalEvaluated * 100).toFixed(1) : '0'}%
              </div>
            </div>
          </div>

          {/* 케이스 분포 */}
          {caseList.length > 0 && (
            <div style={S.card}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>지각 케이스 분포 (전체 {data.totalLate}건)</div>
              <div>{caseList.map(([k, n]) => casePill(k, n))}</div>
            </div>
          )}

          {/* 사람별 테이블 */}
          <div style={S.card}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
              사람별 ({data.peopleStats.length}명)
            </div>
            {data.peopleStats.length === 0 ? (
              <div style={{ color: '#94a3b8', fontSize: 13 }}>이 기간에 평가된 직원 없음.</div>
            ) : (
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px', width: 40 }}>#</th>
                  <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px' }}>이름</th>
                  <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px' }}>직위</th>
                  <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px', width: 80 }}>평가일</th>
                  <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px', width: 70 }}>통과</th>
                  <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px', width: 70 }}>지각</th>
                  <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px', width: 80 }}>지각률</th>
                  <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px', width: 70 }}>수동수정</th>
                  <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px' }}>케이스 분포</th>
                  <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px', width: 70 }}></th>
                </tr>
              </thead>
              <tbody>
                {data.peopleStats.map((p, i) => {
                  const rate = p.evaluated ? (p.late / p.evaluated * 100) : 0
                  const open = expandId === p.employee_id
                  return (
                    <>
                      <tr key={p.employee_id}>
                        <td style={{ border: '1px solid #e5e7eb', padding: '4px 8px', color: '#94a3b8', fontFamily: 'monospace' }}>{i + 1}</td>
                        <td style={{ border: '1px solid #e5e7eb', padding: '4px 8px', fontWeight: 600 }}>{p.name}</td>
                        <td style={{ border: '1px solid #e5e7eb', padding: '4px 8px', color: '#64748b' }}>{p.position || '-'}</td>
                        <td style={{ border: '1px solid #e5e7eb', padding: '4px 8px', textAlign: 'center', fontFamily: 'monospace' }}>{p.evaluated}</td>
                        <td style={{ border: '1px solid #e5e7eb', padding: '4px 8px', textAlign: 'center', color: '#166534', fontFamily: 'monospace' }}>{p.pass}</td>
                        <td style={{ border: '1px solid #e5e7eb', padding: '4px 8px', textAlign: 'center', color: p.late > 0 ? '#b91c1c' : '#94a3b8', fontFamily: 'monospace', fontWeight: 700 }}>{p.late}</td>
                        <td style={{ border: '1px solid #e5e7eb', padding: '4px 8px', textAlign: 'center', color: rate > 10 ? '#b91c1c' : rate > 5 ? '#ea580c' : '#0f172a', fontFamily: 'monospace' }}>
                          {rate.toFixed(1)}%
                        </td>
                        <td style={{ border: '1px solid #e5e7eb', padding: '4px 8px', textAlign: 'center', color: p.override > 0 ? '#f59e0b' : '#cbd5e1', fontFamily: 'monospace' }}>{p.override || '-'}</td>
                        <td style={{ border: '1px solid #e5e7eb', padding: '4px 8px' }}>
                          {Object.entries(p.caseBreakdown).sort((a, b) => b[1] - a[1]).map(([k, n]) => casePill(k, n))}
                        </td>
                        <td style={{ border: '1px solid #e5e7eb', padding: '4px 8px' }}>
                          {p.late > 0 && (
                            <button style={S.btn} onClick={() => setExpandId(open ? null : p.employee_id)}>
                              {open ? '닫기' : '상세'}
                            </button>
                          )}
                        </td>
                      </tr>
                      {open && p.lateRecords.length > 0 && (
                        <tr key={`${p.employee_id}-detail`}>
                          <td colSpan={10} style={{ background: '#fffbeb', padding: 10 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: '#92400e' }}>
                              {p.name} · 지각 {p.late}건 상세
                            </div>
                            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
                              <thead>
                                <tr style={{ background: '#fef3c7' }}>
                                  <th style={{ border: '1px solid #fde68a', padding: '4px 6px' }}>날짜</th>
                                  <th style={{ border: '1px solid #fde68a', padding: '4px 6px' }}>출근시간</th>
                                  <th style={{ border: '1px solid #fde68a', padding: '4px 6px' }}>마감</th>
                                  <th style={{ border: '1px solid #fde68a', padding: '4px 6px' }}>케이스</th>
                                  <th style={{ border: '1px solid #fde68a', padding: '4px 6px' }}>사유</th>
                                  <th style={{ border: '1px solid #fde68a', padding: '4px 6px' }}>근무상태</th>
                                  <th style={{ border: '1px solid #fde68a', padding: '4px 6px' }}>비고</th>
                                </tr>
                              </thead>
                              <tbody>
                                {p.lateRecords.map(r => (
                                  <tr key={r.record_id}>
                                    <td style={{ border: '1px solid #fde68a', padding: '3px 6px', fontFamily: 'monospace' }}>{r.date}</td>
                                    <td style={{ border: '1px solid #fde68a', padding: '3px 6px', fontFamily: 'monospace' }}>{r.check_in_time || '-'}</td>
                                    <td style={{ border: '1px solid #fde68a', padding: '3px 6px', fontFamily: 'monospace', color: '#64748b' }}>{r.late_deadline || '-'}</td>
                                    <td style={{ border: '1px solid #fde68a', padding: '3px 6px', fontFamily: 'monospace', color: '#92400e' }}>{r.late_case_id}</td>
                                    <td style={{ border: '1px solid #fde68a', padding: '3px 6px' }}>{r.late_reason}</td>
                                    <td style={{ border: '1px solid #fde68a', padding: '3px 6px' }}>
                                      {(r.items || []).length === 0
                                        ? <span style={{ color: '#cbd5e1' }}>—</span>
                                        : r.items.map((it, j) => <CategoryPill key={j} it={it} />)}
                                    </td>
                                    <td style={{ border: '1px solid #fde68a', padding: '3px 6px', color: '#92400e' }}>
                                      {r.manual_override === 1 && '✱ 수동수정'}
                                      {r.manual_note && <div style={{ fontSize: 10 }}>{r.manual_note}</div>}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
            )}
          </div>

          {/* 일자별 — 한눈에 */}
          {data.days?.length > 0 && (
            <div style={S.card}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>일자별 ({data.days.length}일)</div>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px' }}>날짜</th>
                    <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px' }}>평가 인원</th>
                    <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px' }}>통과</th>
                    <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px' }}>지각</th>
                    <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px' }}>주말/스킵</th>
                    <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px' }}>지각률</th>
                  </tr>
                </thead>
                <tbody>
                  {data.days.map(d => {
                    const r = d.evaluated ? (d.late / d.evaluated * 100) : 0
                    return (
                      <tr key={d.date}>
                        <td style={{ border: '1px solid #e5e7eb', padding: '4px 8px', fontFamily: 'monospace' }}>{d.date}</td>
                        <td style={{ border: '1px solid #e5e7eb', padding: '4px 8px', textAlign: 'center', fontFamily: 'monospace' }}>{d.evaluated}</td>
                        <td style={{ border: '1px solid #e5e7eb', padding: '4px 8px', textAlign: 'center', color: '#166534', fontFamily: 'monospace' }}>{d.pass}</td>
                        <td style={{ border: '1px solid #e5e7eb', padding: '4px 8px', textAlign: 'center', color: d.late > 0 ? '#b91c1c' : '#94a3b8', fontFamily: 'monospace', fontWeight: 700 }}>{d.late}</td>
                        <td style={{ border: '1px solid #e5e7eb', padding: '4px 8px', textAlign: 'center', color: '#94a3b8', fontFamily: 'monospace' }}>{d.skip}</td>
                        <td style={{ border: '1px solid #e5e7eb', padding: '4px 8px', textAlign: 'center', fontFamily: 'monospace', color: r > 10 ? '#b91c1c' : '#0f172a' }}>
                          {r.toFixed(1)}%
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
