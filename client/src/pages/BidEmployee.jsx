import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authFetch } from '../auth.js'

// ─ 계산 헬퍼 ─
const today = () => { const d = new Date(); d.setHours(0,0,0,0); return d }
function toDate(s) { return s ? new Date(s + 'T00:00:00') : null }

function ageInYears(birth) {
  const b = toDate(birth); if (!b) return null
  const t = today()
  let y = t.getFullYear() - b.getFullYear()
  const m = t.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && t.getDate() < b.getDate())) y--
  return y
}
function diffYM(fromStr) {
  const f = toDate(fromStr); if (!f) return { y: null, m: null, total: null, label: '' }
  const t = today()
  let y = t.getFullYear() - f.getFullYear()
  let m = t.getMonth() - f.getMonth()
  if (t.getDate() < f.getDate()) m -= 1
  if (m < 0) { y -= 1; m += 12 }
  return { y, m, total: y * 12 + m, label: `${y}년 ${m}개월` }
}
function diffDays(fromStr) {
  const f = toDate(fromStr); if (f === null) return null
  return Math.floor((today() - f) / 86400000)
}

// ─ 빈 row 폼 (추가/편집 공용) ─
const EMPTY = {
  name: '', birth_date: '', position: '', final_edu: '', school: '', major: '',
  grad_year: '', grad_month: '',
  external_join_date: '', real_join_date: '',
}

export default function BidEmployee() {
  const nav = useNavigate()
  const [list, setList] = useState([])
  const [err, setErr] = useState(null)
  const [editId, setEditId] = useState(null)
  const [draft, setDraft] = useState(EMPTY)
  const [adding, setAdding] = useState(false)
  const [sort, setSort] = useState({ key: 'id', dir: 'asc' })

  const load = async () => {
    setErr(null)
    try {
      const r = await authFetch('/api/admin/bid-employees')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setList(j.items || [])
    } catch (e) { setErr(e.message) }
  }
  useEffect(() => { load() }, [])

  const toggleAttendanceTarget = async (row) => {
    const next = row.attendance_target === 1 ? 0 : 1
    // 낙관적 업데이트
    setList(prev => prev.map(x => x.id === row.id ? { ...x, attendance_target: next } : x))
    try {
      const r = await authFetch(`/api/admin/bid-employees/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attendance_target: next }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
    } catch (e) {
      setErr(e.message)
      // 롤백
      setList(prev => prev.map(x => x.id === row.id ? { ...x, attendance_target: row.attendance_target } : x))
    }
  }

  const startEdit = (row) => {
    setEditId(row.id); setAdding(false)
    setDraft({
      name: row.name || '', birth_date: row.birth_date || '',
      position: row.position || '', final_edu: row.final_edu || '',
      school: row.school || '', major: row.major || '',
      grad_year: row.grad_year || '', grad_month: row.grad_month || '',
      external_join_date: row.external_join_date || '',
      real_join_date: row.real_join_date || '',
    })
  }
  const cancelEdit = () => { setEditId(null); setAdding(false); setDraft(EMPTY) }

  const saveEdit = async () => {
    try {
      const r = await authFetch(`/api/admin/bid-employees/${editId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      cancelEdit(); await load()
    } catch (e) { setErr(e.message) }
  }

  const saveNew = async () => {
    if (!draft.name) { setErr('성명 필수'); return }
    try {
      const r = await authFetch(`/api/admin/bid-employees`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      cancelEdit(); await load()
    } catch (e) { setErr(e.message) }
  }

  const remove = async (id, name) => {
    if (!confirm(`${name} 삭제?`)) return
    try {
      const r = await authFetch(`/api/admin/bid-employees/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      await load()
    } catch (e) { setErr(e.message) }
  }

  const onField = (k) => (e) => setDraft(d => ({ ...d, [k]: e.target.value }))

  // ─ 정렬 ─
  const sortBy = (k) => setSort(s =>
    s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' }
  )
  const valOf = (row, key) => {
    switch (key) {
      case 'id':                 return row.id
      case 'name':               return row.name || ''
      case 'birth_date':         return row.birth_date || ''
      case 'age':                return ageInYears(row.birth_date)
      case 'position':           return row.position || ''
      case 'final_edu':          return row.final_edu || ''
      case 'school':             return row.school || ''
      case 'major':              return row.major || ''
      case 'grad':               return (row.grad_year || 0) * 100 + (row.grad_month || 0)
      case 'external_join_date': return row.external_join_date || ''
      case 'career':             return diffYM(row.external_join_date).total
      case 'real_join_date':     return row.real_join_date || ''
      case 'stay':               return diffDays(row.real_join_date)
      default: return null
    }
  }
  const sorted = useMemo(() => {
    const arr = [...list]
    const dir = sort.dir === 'asc' ? 1 : -1
    arr.sort((a, b) => {
      const va = valOf(a, sort.key), vb = valOf(b, sort.key)
      // null/빈 값은 항상 뒤로
      const aEmpty = va == null || va === ''
      const bEmpty = vb == null || vb === ''
      if (aEmpty && bEmpty) return 0
      if (aEmpty) return 1
      if (bEmpty) return -1
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return String(va).localeCompare(String(vb), 'ko') * dir
    })
    return arr
  }, [list, sort])

  // 헤더 셀
  const Th = ({ k, label, w }) => (
    <th
      onClick={() => sortBy(k)}
      style={{ cursor: 'pointer', userSelect: 'none', width: w }}
      className={sort.key === k ? 'sorted' : ''}
    >
      {label}
      <span className="sort-mark">
        {sort.key === k ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
      </span>
    </th>
  )

  const editRow = (forNew = false) => (
    <tr className="edit-row">
      <td className="mono">{forNew ? '신규' : editId}</td>
      <td><input className="row-input" value={draft.name} onChange={onField('name')} placeholder="성명" /></td>
      <td><input className="row-input" type="date" value={draft.birth_date} onChange={onField('birth_date')} /></td>
      <td className="muted small">자동</td>
      <td><input className="row-input" value={draft.position} onChange={onField('position')} placeholder="직위" /></td>
      <td><input className="row-input" value={draft.final_edu} onChange={onField('final_edu')} placeholder="학사" /></td>
      <td><input className="row-input" value={draft.school} onChange={onField('school')} placeholder="학교" /></td>
      <td><input className="row-input" value={draft.major} onChange={onField('major')} placeholder="전공" /></td>
      <td>
        <div className="row-input-pair">
          <input className="row-input" style={{width:54}} type="number" placeholder="YYYY" value={draft.grad_year} onChange={onField('grad_year')} />
          <input className="row-input" style={{width:42}} type="number" placeholder="M" value={draft.grad_month} onChange={onField('grad_month')} />
        </div>
      </td>
      <td><input className="row-input" type="date" value={draft.external_join_date} onChange={onField('external_join_date')} /></td>
      <td className="muted small">자동</td>
      <td><input className="row-input" type="date" value={draft.real_join_date} onChange={onField('real_join_date')} /></td>
      <td className="muted small">자동</td>
      <td className="muted small center">{forNew ? '추가 후 토글' : '체크박스로'}</td>
      <td>
        <button className="sm-btn primary" onClick={forNew ? saveNew : saveEdit}>저장</button>
        <button className="sm-btn" onClick={cancelEdit}>취소</button>
      </td>
    </tr>
  )

  return (
    <div>
      <div className="page-head">
        <h2>입찰 — 직원</h2>
        <div className="page-sub">참여 인력 정보 ({list.length}명)</div>
      </div>

      <div className="bar">
        <button className="btn-primary" onClick={() => { setAdding(true); setEditId(null); setDraft(EMPTY) }} disabled={adding}>
          + 신규 추가
        </button>
      </div>

      {err && <div className="error">{err}</div>}

      <div className="table-wrap">
        <table className="admin-table emp-table">
          <thead>
            <tr>
              <th style={{width:34}}>#</th>
              <Th k="name" label="성명" />
              <Th k="birth_date" label="생년월일" />
              <Th k="age" label="나이" />
              <Th k="position" label="직위" />
              <Th k="final_edu" label="학력" />
              <Th k="school" label="학교" />
              <Th k="major" label="전공" />
              <Th k="grad" label="졸업" />
              <Th k="external_join_date" label="외부용 입사" />
              <Th k="career" label="경력" />
              <Th k="real_join_date" label="실제 입사" />
              <Th k="stay" label="재직" />
              <th style={{width:90}} title="출퇴근 크롤링 평가 대상 여부">출결 대상</th>
              <th style={{width:220}}></th>
            </tr>
          </thead>
          <tbody>
            {adding && editRow(true)}
            {sorted.map((r, idx) => {
              if (editId === r.id) return editRow(false)
              const career = diffYM(r.external_join_date)
              const stayDays = diffDays(r.real_join_date)
              const stayY = diffYM(r.real_join_date).y
              return (
                <tr key={r.id}>
                  <td className="mono">{idx + 1}</td>
                  <td className="bold">
                    <a
                      href={`/bid/employee/${r.id}`}
                      onClick={(e) => { e.preventDefault(); nav(`/bid/employee/${r.id}`) }}
                      style={{ color: '#1d4ed8', textDecoration: 'none' }}
                      title="상세 보기"
                    >
                      {r.name}
                    </a>
                  </td>
                  <td className="mono small">{r.birth_date || '-'}</td>
                  <td className="center">{ageInYears(r.birth_date) ?? ''}</td>
                  <td>{r.position || '-'}</td>
                  <td>{r.final_edu || '-'}</td>
                  <td>{r.school || '-'}</td>
                  <td className="muted">{r.major || '-'}</td>
                  <td className="mono small">{r.grad_year || ''}{r.grad_month ? '.' + r.grad_month : ''}</td>
                  <td className="mono small">{r.external_join_date || '-'}</td>
                  <td className="small">{career.label || '-'}</td>
                  <td className="mono small">{r.real_join_date || '-'}</td>
                  <td className="small">{stayDays != null ? `${stayDays}일 (${stayY}년)` : '-'}</td>
                  <td className="center">
                    <label style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <input
                        type="checkbox"
                        checked={r.attendance_target === 1}
                        onChange={() => toggleAttendanceTarget(r)}
                      />
                      <span style={{
                        fontSize: 11,
                        color: r.attendance_target === 1 ? '#166534' : '#94a3b8',
                        fontWeight: 600,
                      }}>
                        {r.attendance_target === 1 ? '포함' : '제외'}
                      </span>
                    </label>
                  </td>
                  <td>
                    <button className="sm-btn" onClick={() => nav(`/bid/employee/${r.id}`)}>상세</button>
                    <button className="sm-btn" onClick={() => startEdit(r)}>수정</button>
                    <button className="sm-btn danger" onClick={() => remove(r.id, r.name)}>삭제</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
