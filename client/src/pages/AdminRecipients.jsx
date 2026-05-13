import { useEffect, useState } from 'react'
import { authFetch } from '../auth.js'

export default function AdminRecipients() {
  const [list, setList] = useState([])
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  // 편집 상태: { id, email, name }
  const [edit, setEdit] = useState(null)

  const load = async () => {
    setErr(null)
    try {
      const r = await authFetch('/api/admin/recipients')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setList(j.items || [])
    } catch (e) { setErr(e.message) }
  }
  useEffect(() => { load() }, [])

  const add = async (e) => {
    e.preventDefault()
    if (!email) return
    setBusy(true)
    try {
      const r = await authFetch('/api/admin/recipients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name: name || null }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setEmail(''); setName('')
      await load()
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  const startEdit = (r) => setEdit({ id: r.id, email: r.email, name: r.name || '' })
  const cancelEdit = () => setEdit(null)
  const saveEdit = async () => {
    if (!edit || !edit.email) return
    try {
      const r = await authFetch(`/api/admin/recipients/${edit.id}`, {
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
      const res = await authFetch(`/api/admin/recipients/${r.id}`, {
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
        <h2>수신자 관리</h2>
        <div className="page-sub">cron 실행 시 활성 수신자에게 일괄 발송</div>
      </div>

      <form className="recipient-form" onSubmit={add}>
        <input type="email" placeholder="email@example.com" value={email} onChange={e => setEmail(e.target.value)} />
        <input type="text" placeholder="이름 (선택)" value={name} onChange={e => setName(e.target.value)} />
        <button type="submit" disabled={busy || !email}>추가</button>
      </form>

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
