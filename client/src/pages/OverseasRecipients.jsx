import { useEffect, useState } from 'react'
import { authFetch } from '../auth.js'

export default function OverseasRecipients() {
  const [list, setList] = useState([])
  const [employees, setEmployees] = useState([])
  const [selEmpId, setSelEmpId] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [edit, setEdit] = useState(null)

  const load = async () => {
    setErr(null)
    try {
      const r = await authFetch('/api/admin/overseas/recipients')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setList(j.items || [])
      const re = await authFetch('/api/admin/bid-employees')
      if (!re.ok) throw new Error(`HTTP ${re.status}`)
      const je = await re.json()
      setEmployees((je.items || je || []).filter(e => e.active && e.email))
    } catch (e) { setErr(e.message) }
  }
  useEffect(() => { load() }, [])

  // 이미 활성 수신자로 등록된 이메일은 선택지에서 제외 (비활성 등록자는 재선택 → 재활성화)
  const activeEmails = new Set(list.filter(r => r.active).map(r => r.email))
  const candidates = employees.filter(e => !activeEmails.has(e.email))

  const add = async (e) => {
    e.preventDefault()
    const emp = employees.find(x => String(x.id) === String(selEmpId))
    if (!emp) return
    setBusy(true)
    try {
      const r = await authFetch('/api/admin/overseas/recipients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emp.email, name: emp.name || null }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setSelEmpId('')
      await load()
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  const startEdit = (r) => setEdit({ id: r.id, email: r.email, name: r.name || '' })
  const cancelEdit = () => setEdit(null)
  const saveEdit = async () => {
    if (!edit || !edit.email) return
    try {
      const r = await authFetch(`/api/admin/overseas/recipients/${edit.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: edit.email, name: edit.name || null }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setEdit(null)
      await load()
    } catch (e) { setErr(e.message) }
  }

  const toggleActive = async (r) => {
    try {
      const res = await authFetch(`/api/admin/overseas/recipients/${r.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: r.active ? 0 : 1 }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await load()
    } catch (e) { setErr(e.message) }
  }

  return (
    <div>
      <div className="page-head">
        <h2>해외 공고 수신자 관리</h2>
        <div className="page-sub">해외 공고 cron 실행 시 활성 수신자에게 일괄 발송 (채용공고 수신자와 별개)</div>
      </div>

      <form className="recipient-form" onSubmit={add}>
        <select value={selEmpId} onChange={e => setSelEmpId(e.target.value)}>
          <option value="">직원 선택…</option>
          {candidates.map(e => (
            <option key={e.id} value={e.id}>
              {e.name}{e.position ? ` (${e.position})` : ''} — {e.email}
            </option>
          ))}
        </select>
        <button type="submit" disabled={busy || !selEmpId}>추가</button>
      </form>
      <p className="small muted">
        * 직원 관리(입찰 → 직원)에 등록된 활성 직원 중 이메일이 있는 사람만 선택할 수 있습니다.
        {employees.length === 0 && ' — 선택 가능한 직원이 없습니다.'}
      </p>

      {err && <div className="error">{err}</div>}

      <table className="admin-table">
        <thead>
          <tr>
            <th style={{width:40}}>#</th>
            <th>이메일</th>
            <th style={{width:140}}>이름</th>
            <th style={{width:80,textAlign:'center'}}>상태</th>
            <th style={{width:100}}>등록일</th>
            <th style={{width:200}}></th>
          </tr>
        </thead>
        <tbody>
          {list.map(r => {
            const isEditing = edit && edit.id === r.id
            return (
              <tr key={r.id} className={r.active ? '' : 'inactive'}>
                <td className="mono">{r.id}</td>
                <td>
                  {isEditing ? (
                    <input
                      type="email" className="row-input" autoFocus
                      value={edit.email}
                      onChange={e => setEdit({...edit, email: e.target.value})}
                    />
                  ) : r.email}
                </td>
                <td>
                  {isEditing ? (
                    <input
                      type="text" className="row-input"
                      value={edit.name}
                      onChange={e => setEdit({...edit, name: e.target.value})}
                    />
                  ) : (r.name || '-')}
                </td>
                <td className="center">
                  {r.active
                    ? <span className="badge agent">활성</span>
                    : <span className="badge other">비활성</span>}
                </td>
                <td className="small muted">{new Date(r.created_at).toLocaleDateString('ko-KR')}</td>
                <td>
                  {isEditing ? (
                    <>
                      <button onClick={saveEdit} className="sm-btn primary">저장</button>
                      <button onClick={cancelEdit} className="sm-btn">취소</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => startEdit(r)} className="sm-btn">수정</button>
                      <button onClick={() => toggleActive(r)} className={r.active ? 'sm-btn danger' : 'sm-btn'}>
                        {r.active ? '비활성화' : '활성화'}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
