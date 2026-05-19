// 출퇴근 관리 — 실험실
// 흐름 (Cloudflare 우회 못해서 쿠키 방식으로 결정):
//   1. 사용자가 본인 Chrome 에서 메일플러그 로그인
//   2. DevTools → Network → 아무 request → Request Headers → Cookie 값 복사
//   3. 여기 textarea 에 붙여넣고 저장 → DB 의 app_secrets 에 저장
//   4. "크롤 실행" 누르면 그 쿠키로 자동 진입 (headless)
//   5. 쿠키 만료 시 자동 감지 → 다시 등록 안내
import { useEffect, useState } from 'react'
import { authFetch } from '../auth.js'

// 12컬럼 헤더 — 메일플러그 엑셀 헤더 그대로
const COLUMNS = [
  { key: 'date',              label: '날짜' },
  { key: 'name',              label: '이름' },
  { key: 'emp_no',            label: '사번' },
  { key: 'dept',              label: '소속' },
  { key: 'position',          label: '직위' },
  { key: 'work_type',         label: '근무유형' },
  { key: 'check_in_time',     label: '출근시간' },
  { key: 'check_in_outside',  label: '근무지 외 출근' },
  { key: 'check_out_time',    label: '퇴근시간' },
  { key: 'check_out_outside', label: '근무지 외 퇴근' },
  { key: 'commute_status',    label: '출퇴근 상태' },
  { key: 'work_status',       label: '근무 상태' },
]

const S = {
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 18, marginBottom: 14 },
  cardTitle: { fontWeight: 700, fontSize: 14, marginBottom: 10, color: '#0f172a' },
  bigBtn: {
    padding: '12px 26px', fontSize: 14, border: 'none', borderRadius: 8,
    background: '#0f172a', color: '#fff', cursor: 'pointer', fontWeight: 700,
  },
  primaryBtn: {
    padding: '10px 18px', fontSize: 13, border: 'none', borderRadius: 6,
    background: '#1d4ed8', color: '#fff', cursor: 'pointer', fontWeight: 700,
  },
  ghostBtn: { padding: '6px 12px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', cursor: 'pointer', color: '#0f172a' },
  errBox: { background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: 10, borderRadius: 8, fontSize: 13, marginBottom: 12 },
  okBox: { background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', padding: 10, borderRadius: 8, fontSize: 13, marginBottom: 12 },
  textarea: {
    width: '100%', minHeight: 100, padding: 10, fontSize: 12,
    border: '1px solid #d1d5db', borderRadius: 6, background: '#fff',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    resize: 'vertical', boxSizing: 'border-box',
  },
  guideBox: {
    background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8,
    padding: 12, fontSize: 12, color: '#9a3412', lineHeight: 1.7, marginBottom: 12,
  },
  statusGrid: {
    display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px',
    fontSize: 13, marginTop: 6,
  },
  badge: (color) => ({
    display: 'inline-block', padding: '2px 10px', borderRadius: 999,
    background: color, color: '#fff', fontSize: 11, fontWeight: 700,
  }),
  stepList: {
    background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8,
    padding: 12, fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    color: '#334155', whiteSpace: 'pre-wrap',
  },
  bodyPreview: {
    background: '#0f172a', color: '#e2e8f0', fontSize: 11.5,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    padding: 12, borderRadius: 8, whiteSpace: 'pre-wrap',
    maxHeight: 380, overflow: 'auto',
  },
}

function fmtTs(s) {
  if (!s) return '-'
  return s.replace('T', ' ').replace('Z', '').slice(0, 19)
}
function daysSince(s) {
  if (!s) return null
  const d = new Date(s.replace(' ', 'T'))
  if (isNaN(d.getTime())) return null
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24))
}

const CATEGORY_COLORS = {
  '외근':       '#1d4ed8',
  '출장':       '#0891b2',
  '재택근무':   '#7c3aed',
  '연장근로':   '#0f766e',
  '반차':       '#ea580c',
  '반의반차':   '#f59e0b',
  '종일':       '#64748b',
  '겨울방학':   '#0284c7',
  '여름방학':   '#dc2626',
  '경조휴가':   '#a16207',
  '유급기타휴가': '#9ca3af',
  '무급기타휴가': '#6b7280',
  '병가':       '#be123c',
  '연차':       '#16a34a',
  '기타':       '#94a3b8',
}

function StatusItemPill({ it }) {
  const color = CATEGORY_COLORS[it.category] || '#64748b'
  const labelExtra =
    it.sub_type ? ` ${it.sub_type}` :
    it.range_type === 'time' ? ` ${it.start_time} ~ ${it.end_time}${it.duration_minutes ? ` (${it.duration_minutes}분)` : ''}` :
    it.range_type === 'date' ? ` ${it.start_date} ~ ${it.end_date}` : ''
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 999,
      background: color + '20', color, border: `1px solid ${color}40`,
      fontSize: 11, fontWeight: 600, margin: '2px 4px 2px 0',
    }}>
      {it.category}{labelExtra}
    </span>
  )
}

// 결과 카드용 — 크롤 직후 raw 12컬럼
function RecordsTable({ rows }) {
  if (!rows || rows.length === 0) return <div style={{ color: '#94a3b8', fontSize: 12 }}>데이터 없음</div>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
        <thead>
          <tr style={{ background: '#f8fafc' }}>
            <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px', width: 40 }}>#</th>
            {COLUMNS.map(c => (
              <th key={c.key} style={{ border: '1px solid #e5e7eb', padding: '6px 8px' }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={{ border: '1px solid #e5e7eb', padding: '4px 8px', color: '#94a3b8', fontFamily: 'monospace' }}>{i + 1}</td>
              {COLUMNS.map(c => (
                <td key={c.key} style={{
                  border: '1px solid #e5e7eb', padding: '4px 8px',
                  whiteSpace: 'pre-wrap',
                  fontWeight: c.key === 'name' ? 600 : 400,
                  fontFamily: ['check_in_time', 'check_out_time', 'date'].includes(c.key) ? 'monospace' : 'inherit',
                }}>
                  {String(r[c.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// 지각 판정 pill
function LatePill({ row, onPatch }) {
  const isLate = row.is_late;
  const override = !!row.manual_override;
  let bg = '#e2e8f0', fg = '#475569', label = '주말'
  if (isLate === 0)      { bg = '#dcfce7'; fg = '#166534'; label = '통과' }
  else if (isLate === 1) { bg = '#fee2e2'; fg = '#b91c1c'; label = '지각' }
  // 클릭 시 cycle: 통과 → 지각 → 주말(null) → 자동복원 → 통과 ...
  const cycle = async () => {
    if (!onPatch) return
    let next, reset = false
    if (override) {
      // 자동복원
      reset = true
    } else if (isLate === 0) next = 1
    else if (isLate === 1) next = null
    else next = 0
    await onPatch(row.id, reset ? { reset: true } : { is_late: next })
  }
  return (
    <span
      onClick={cycle}
      title={`${row.late_case_id || '-'} | ${row.late_reason || ''}${override ? '\n(수동 수정 — 클릭하면 자동복원)' : '\n(클릭으로 변경)'}`}
      style={{
        display: 'inline-block', padding: '2px 8px', borderRadius: 999,
        background: bg, color: fg, fontSize: 11, fontWeight: 700, cursor: 'pointer',
        border: override ? '2px solid #f59e0b' : '1px solid transparent',
      }}
    >
      {label}{override && ' ✱'}
    </span>
  )
}

// 스냅샷 펼침용 — 직원 매핑 + status items 분리 표시 + 지각 판정
function EnrichedRecordsTable({ rows, onPatch }) {
  if (!rows || rows.length === 0) return <div style={{ color: '#94a3b8', fontSize: 12 }}>데이터 없음</div>
  // 통계
  const stat = rows.reduce((a, r) => {
    if (r.is_late === 0) a.pass++
    else if (r.is_late === 1) a.late++
    else a.skip++
    if (r.manual_override) a.override++
    return a
  }, { pass: 0, late: 0, skip: 0, override: 0 })
  return (
    <div>
      <div style={{ fontSize: 12, marginBottom: 8, color: '#475569' }}>
        <span style={{ marginRight: 14 }}>통과 <strong style={{ color: '#166534' }}>{stat.pass}</strong></span>
        <span style={{ marginRight: 14 }}>지각 <strong style={{ color: '#b91c1c' }}>{stat.late}</strong></span>
        <span style={{ marginRight: 14 }}>주말/스킵 <strong>{stat.skip}</strong></span>
        {stat.override > 0 && <span>수동수정 <strong style={{ color: '#f59e0b' }}>{stat.override}</strong></span>}
      </div>
      <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
        <thead>
          <tr style={{ background: '#f8fafc' }}>
            <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px', width: 40 }}>#</th>
            <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px' }}>날짜</th>
            <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px' }}>직원 (DB)</th>
            <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px', width: 90 }}>지각</th>
            <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px', minWidth: 240 }}>사유</th>
            <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px' }}>출근시간</th>
            <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px', minWidth: 280 }}>근무 상태 (분리)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id || i}>
              <td style={{ border: '1px solid #e5e7eb', padding: '4px 8px', color: '#94a3b8', fontFamily: 'monospace' }}>{i + 1}</td>
              <td style={{ border: '1px solid #e5e7eb', padding: '4px 8px', fontFamily: 'monospace' }}>{r.date}</td>
              <td style={{ border: '1px solid #e5e7eb', padding: '4px 8px' }}>
                <strong>{r.employee_name || r.name}</strong>
                {r.employee_id && (
                  <span style={{ marginLeft: 6, fontSize: 10, color: '#94a3b8' }}>#{r.employee_id}</span>
                )}
              </td>
              <td style={{ border: '1px solid #e5e7eb', padding: '4px 8px', textAlign: 'center' }}>
                <LatePill row={r} onPatch={onPatch} />
              </td>
              <td style={{ border: '1px solid #e5e7eb', padding: '4px 8px', fontSize: 11, color: '#334155' }}>
                {r.late_case_id && (
                  <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 4, background: '#f1f5f9', color: '#475569', fontFamily: 'monospace', fontSize: 10, marginRight: 6 }}>
                    {r.late_case_id}
                  </span>
                )}
                <span>{r.late_reason || '—'}</span>
                {r.manual_override === 1 && r.manual_note && (
                  <div style={{ marginTop: 3, fontSize: 10, color: '#92400e' }}>
                    📝 {r.manual_note}
                  </div>
                )}
              </td>
              <td style={{ border: '1px solid #e5e7eb', padding: '4px 8px', fontFamily: 'monospace' }}>{r.check_in_time}</td>
              <td style={{ border: '1px solid #e5e7eb', padding: '4px 8px' }}>
                {(r.items || []).length === 0
                  ? <span style={{ color: '#cbd5e1' }}>—</span>
                  : (r.items || []).map((it, j) => <StatusItemPill key={j} it={it} />)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  )
}

export default function AttendanceLab() {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const [status, setStatus] = useState(null)
  const [cookie, setCookie] = useState('')
  const [note, setNote] = useState('')
  const [result, setResult] = useState(null)
  const [snapshots, setSnapshots] = useState([])
  const [openSnapshotId, setOpenSnapshotId] = useState(null)
  const [openSnapshotData, setOpenSnapshotData] = useState(null)

  const loadStatus = async () => {
    try {
      const r = await authFetch('/api/admin/attendance/cookies')
      if (!r.ok) return
      const j = await r.json()
      setStatus(j)
    } catch {}
  }
  const loadSnapshots = async () => {
    try {
      const r = await authFetch('/api/admin/attendance/snapshots?limit=50')
      if (!r.ok) return
      const j = await r.json()
      setSnapshots(j.items || [])
    } catch {}
  }
  const openSnapshot = async (id) => {
    if (openSnapshotId === id) { setOpenSnapshotId(null); setOpenSnapshotData(null); return }
    setOpenSnapshotId(id); setOpenSnapshotData(null)
    try {
      const r = await authFetch(`/api/admin/attendance/snapshots/${id}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setOpenSnapshotData(j)
    } catch (e) {
      setErr(e.message)
    }
  }
  const patchRecord = async (recordId, body) => {
    try {
      const r = await authFetch(`/api/admin/attendance/records/${recordId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      // 펼친 스냅샷 다시 fetch
      if (openSnapshotId != null) {
        const r2 = await authFetch(`/api/admin/attendance/snapshots/${openSnapshotId}`)
        if (r2.ok) setOpenSnapshotData(await r2.json())
      }
    } catch (e) { setErr(e.message) }
  }
  const delSnapshot = async (id) => {
    if (!confirm(`스냅샷 #${id} 삭제?`)) return
    try {
      const r = await authFetch(`/api/admin/attendance/snapshots/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      if (openSnapshotId === id) { setOpenSnapshotId(null); setOpenSnapshotData(null) }
      await loadSnapshots()
    } catch (e) { setErr(e.message) }
  }
  useEffect(() => { loadStatus(); loadSnapshots() }, [])

  const saveCookie = async () => {
    if (!cookie.trim()) { setErr('쿠키를 붙여넣어주세요'); return }
    setErr(''); setOkMsg(''); setBusy(true)
    try {
      const r = await authFetch('/api/admin/attendance/cookies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookie: cookie.trim(), note: note.trim() || null }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setOkMsg('쿠키 저장 완료')
      setCookie(''); setNote('')
      await loadStatus()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const runCrawl = async () => {
    setErr(''); setOkMsg(''); setResult(null); setBusy(true)
    try {
      const r = await authFetch('/api/admin/attendance/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'cookie' }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setResult(j)
      await loadStatus()
      await loadSnapshots()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const updatedDays = status?.updated_at ? daysSince(status.updated_at) : null
  const usedDays = status?.last_used_at ? daysSince(status.last_used_at) : null

  return (
    <div>
      <div className="page-head">
        <h2>출퇴근 관리 — 실험실</h2>
        <div className="page-sub">메일플러그 쿠키 등록 → 자동 크롤 (Cloudflare 캡차 우회)</div>
      </div>

      {err && <div style={S.errBox}>{err}</div>}
      {okMsg && <div style={S.okBox}>{okMsg}</div>}

      {/* 스냅샷 목록 */}
      <div style={S.card}>
        <div style={S.cardTitle}>
          저장된 스냅샷
          <span style={{ marginLeft: 8, ...S.badge('#1d4ed8') }}>{snapshots.length}</span>
          <button style={{ ...S.ghostBtn, marginLeft: 8, fontSize: 11 }} onClick={loadSnapshots}>새로고침</button>
        </div>
        {snapshots.length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 12 }}>아직 저장된 스냅샷이 없습니다. "크롤 실행" 으로 첫 스냅샷을 만드세요.</div>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px', width: 50 }}>#</th>
                <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px' }}>조회 시각</th>
                <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px', width: 80 }}>행 수</th>
                <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px' }}>엑셀 파일명</th>
                <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px', width: 160 }}></th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map(s => (
                <>
                  <tr key={s.id}>
                    <td style={{ border: '1px solid #e5e7eb', padding: '4px 8px', fontFamily: 'monospace', color: '#64748b' }}>{s.id}</td>
                    <td style={{ border: '1px solid #e5e7eb', padding: '4px 8px', fontFamily: 'monospace' }}>{fmtTs(s.captured_at)}</td>
                    <td style={{ border: '1px solid #e5e7eb', padding: '4px 8px' }}>{s.row_count}</td>
                    <td style={{ border: '1px solid #e5e7eb', padding: '4px 8px', fontSize: 11, color: '#64748b' }}>{s.excel_filename || '-'}</td>
                    <td style={{ border: '1px solid #e5e7eb', padding: '4px 8px' }}>
                      <button style={S.ghostBtn} onClick={() => openSnapshot(s.id)}>
                        {openSnapshotId === s.id ? '닫기' : '열기'}
                      </button>{' '}
                      <button style={{ ...S.ghostBtn, color: '#b91c1c' }} onClick={() => delSnapshot(s.id)}>삭제</button>
                    </td>
                  </tr>
                  {openSnapshotId === s.id && (
                    <tr key={`${s.id}-body`}>
                      <td colSpan={5} style={{ background: '#f8fafc', padding: 10 }}>
                        {openSnapshotData
                          ? <EnrichedRecordsTable rows={openSnapshotData.rows} onPatch={patchRecord} />
                          : <div style={{ color: '#94a3b8', fontSize: 12 }}>로딩중…</div>}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 상태 */}
      <div style={S.card}>
        <div style={S.cardTitle}>쿠키 등록 상태</div>
        {status?.registered ? (
          <div style={S.statusGrid}>
            <span style={{ color: '#64748b' }}>상태</span>
            <span><span style={S.badge('#16a34a')}>등록됨</span></span>
            <span style={{ color: '#64748b' }}>길이</span>
            <span className="mono">{status.length} 자</span>
            <span style={{ color: '#64748b' }}>등록일</span>
            <span>{fmtTs(status.updated_at)} {updatedDays != null && <span style={{ color: '#94a3b8' }}>({updatedDays}일 전)</span>}</span>
            <span style={{ color: '#64748b' }}>최근 사용</span>
            <span>{status.last_used_at ? `${fmtTs(status.last_used_at)} (${usedDays}일 전)` : '아직 사용 안 됨'}</span>
            {status.note && <>
              <span style={{ color: '#64748b' }}>메모</span>
              <span>{status.note}</span>
            </>}
          </div>
        ) : (
          <div>
            <span style={S.badge('#dc2626')}>미등록</span>
            <span style={{ marginLeft: 10, fontSize: 13, color: '#475569' }}>아래에서 쿠키를 등록해주세요.</span>
          </div>
        )}
      </div>

      {/* 등록 */}
      <div style={S.card}>
        <div style={S.cardTitle}>{status?.registered ? '쿠키 갱신' : '쿠키 등록'}</div>
        <div style={S.guideBox}>
          <strong>가져오는 방법 (본인 Chrome 사용)</strong><br />
          1. 본인 Chrome 에서 <code>https://gw.mailplug.com/</code> 정상 로그인<br />
          2. <code>https://gw.mailplug.com/attendance/works/list/</code> 페이지 진입 (정상 보이는지 확인)<br />
          3. <code>F12</code> → <strong>Network</strong> 탭 → 페이지 새로고침<br />
          4. 첫 번째 request 클릭 → <strong>Request Headers</strong> → <code>Cookie:</code> 옆 값 전부 복사<br />
          5. 아래 textarea 에 붙여넣고 저장
        </div>

        <textarea
          style={S.textarea}
          value={cookie}
          onChange={e => setCookie(e.target.value)}
          placeholder="여기에 Cookie 헤더 값 붙여넣기  (예: PHPSESSID=abc...; loginUser=xyz; ...)"
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="메모 (선택, 예: 2026-05-18 등록)"
            style={{
              flex: 1, padding: '8px 10px', fontSize: 12,
              border: '1px solid #d1d5db', borderRadius: 6, background: '#fff',
              fontFamily: 'inherit', boxSizing: 'border-box',
            }}
          />
          <button style={S.primaryBtn} onClick={saveCookie} disabled={busy}>
            {busy ? '저장중…' : '저장'}
          </button>
        </div>
      </div>

      {/* 크롤 실행 */}
      <div style={S.card}>
        <div style={S.cardTitle}>크롤 실행</div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
          저장된 쿠키로 headless Chrome 띄워 출퇴근 목록 페이지 진입. 쿠키 만료되면 명확한 에러 메시지.
        </div>
        <button
          style={S.bigBtn}
          onClick={runCrawl}
          disabled={busy || !status?.registered}
        >
          {busy ? '크롤중…' : '▶ 크롤 실행'}
        </button>
        {!status?.registered && (
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>
            쿠키를 먼저 등록해야 활성화됩니다.
          </div>
        )}
      </div>

      {result && (
        <>
          <div style={S.card}>
            <div style={S.cardTitle}>진행 단계 로그</div>
            <div style={S.stepList}>
              {(result.steps || []).map((s, i) => `[${i + 1}] ${s}`).join('\n')}
            </div>
          </div>

          {Array.isArray(result.rows) && result.source === 'excel' && (
            <div style={S.card}>
              <div style={S.cardTitle}>
                추출 데이터
                <span style={{ marginLeft: 8, ...S.badge('#16a34a') }}>엑셀 다운로드</span>
                <span style={{ marginLeft: 6, ...S.badge('#1d4ed8') }}>{result.rowCount} 행</span>
                {result.snapshot?.id && (
                  <span style={{ marginLeft: 6, ...S.badge('#9a3412') }}>
                    스냅샷 #{result.snapshot.id} 저장됨
                  </span>
                )}
                {result.excelFilename && (
                  <span style={{ marginLeft: 6, fontSize: 11, color: '#64748b' }}>
                    {result.excelFilename}
                  </span>
                )}
              </div>
              {result.snapshot && (
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>
                  capturedAt: <code>{result.snapshot.capturedAt}</code>
                  {typeof result.snapshot.rowCount === 'number' && (
                    <span style={{ marginLeft: 12 }}>
                      매칭 저장: <strong>{result.snapshot.rowCount}</strong>행
                    </span>
                  )}
                  {typeof result.snapshot.skippedCount === 'number' && result.snapshot.skippedCount > 0 && (
                    <span style={{ marginLeft: 12, color: '#dc2626' }}>
                      매칭 실패 skip: <strong>{result.snapshot.skippedCount}</strong>행
                    </span>
                  )}
                  {typeof result.snapshot.statusItemCount === 'number' && (
                    <span style={{ marginLeft: 12 }}>
                      근무상태 items: <strong>{result.snapshot.statusItemCount}</strong>개
                    </span>
                  )}
                  {result.snapshot.judgmentStats && (
                    <span style={{ marginLeft: 14 }}>
                      판정 ·{' '}
                      <strong style={{ color: '#166534' }}>통과 {result.snapshot.judgmentStats.pass}</strong>
                      {' / '}
                      <strong style={{ color: '#b91c1c' }}>지각 {result.snapshot.judgmentStats.late}</strong>
                      {' / '}
                      <strong>주말 {result.snapshot.judgmentStats.skip}</strong>
                    </span>
                  )}
                </div>
              )}
              {result.snapshot?.skippedNames?.length > 0 && (
                <details style={{ marginBottom: 10, fontSize: 12 }}>
                  <summary style={{ cursor: 'pointer', color: '#9a3412' }}>
                    bid_employees 에 없는 이름 {result.snapshot.skippedNames.length}개 (skip됨)
                  </summary>
                  <div style={{ marginTop: 6, padding: 8, background: '#fef3c7', borderRadius: 6 }}>
                    {result.snapshot.skippedNames.map(s => (
                      <span key={s.name} style={{ marginRight: 8 }}>
                        {s.name} <span style={{ color: '#92400e' }}>×{s.count}</span>
                      </span>
                    ))}
                  </div>
                </details>
              )}
              <RecordsTable rows={result.rows} />
            </div>
          )}

          {Array.isArray(result.rows) && result.source !== 'excel' && (
            <div style={S.card}>
              <div style={S.cardTitle}>
                추출 데이터
                <span style={{ marginLeft: 8, ...S.badge('#92400e') }}>HTML 스크래핑 (fallback)</span>
                <span style={{ marginLeft: 6, ...S.badge('#1d4ed8') }}>{result.rowCount} 행</span>
              </div>
              {result.rows.length === 0 ? (
                <div style={{ color: '#94a3b8', fontSize: 12 }}>데이터 없음</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: '#f8fafc' }}>
                        <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px', width: 40 }}>#</th>
                        <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px' }}>날짜</th>
                        <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px' }}>이름</th>
                        <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px' }}>출근시간</th>
                        <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px' }}>근무상태</th>
                        <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px', background: '#fffbeb', color: '#92400e' }}>상태 디테일</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((r, i) => (
                        <tr key={i}>
                          <td style={{ border: '1px solid #e5e7eb', padding: '4px 8px', color: '#94a3b8', fontFamily: 'monospace' }}>{i + 1}</td>
                          <td style={{ border: '1px solid #e5e7eb', padding: '4px 8px' }}>{r.date}</td>
                          <td style={{ border: '1px solid #e5e7eb', padding: '4px 8px', fontWeight: 600 }}>{r.name}</td>
                          <td style={{ border: '1px solid #e5e7eb', padding: '4px 8px', fontFamily: 'monospace' }}>{r.checkInTime}</td>
                          <td style={{ border: '1px solid #e5e7eb', padding: '4px 8px' }}>{r.status}</td>
                          <td style={{ border: '1px solid #e5e7eb', padding: '4px 8px', background: '#fffbeb', whiteSpace: 'pre-wrap', color: r.statusDetail ? '#0f172a' : '#cbd5e1' }}>
                            {r.statusDetail || '— 못 찾음 —'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* API 응답 — tooltip 데이터 거기 있을 가능성. 매칭 안 됐으면 여기서 확인 */}
          {result.apiUrls && result.apiUrls.length > 0 && (
            <div style={S.card}>
              <div style={S.cardTitle}>API 응답 (디버그)</div>
              <details>
                <summary style={{ cursor: 'pointer', fontSize: 12, color: '#475569' }}>
                  잡힌 URL {result.apiUrls.length}개
                </summary>
                <ul style={{ fontSize: 11, fontFamily: 'monospace', color: '#475569', maxHeight: 200, overflow: 'auto', paddingLeft: 20 }}>
                  {result.apiUrls.map((u, i) => (
                    <li key={i}>{u.status} — {u.url}</li>
                  ))}
                </ul>
              </details>
              {result.apiSample && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: 'pointer', fontSize: 12, color: '#475569' }}>
                    첫 응답 sample (2KB) — {result.apiSample.url}
                  </summary>
                  <pre style={S.bodyPreview}>{result.apiSample.snippet}</pre>
                </details>
              )}
            </div>
          )}

          <div style={S.card}>
            <div style={S.cardTitle}>페이지 정보</div>
            <div style={{ marginBottom: 6, fontSize: 13 }}>
              <strong>title:</strong> {result.title}
            </div>
            <div style={{ marginBottom: 12, fontSize: 13 }}>
              <strong>url:</strong>{' '}
              <a href={result.url} target="_blank" rel="noopener" style={{ color: '#1d4ed8', wordBreak: 'break-all' }}>
                {result.url}
              </a>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
