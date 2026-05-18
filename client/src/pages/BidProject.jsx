// 유사사업 마스터 관리 — CRUD + 참여자 미니뷰
import { Fragment, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authFetch } from '../auth.js'

const S = {
  input: { padding: '7px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, background: '#fff' },
  miniBtn: { padding: '4px 10px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 5, background: '#fff', cursor: 'pointer' },
  primaryBtn: { padding: '5px 12px', fontSize: 12, border: 'none', borderRadius: 5, background: '#1d4ed8', color: '#fff', cursor: 'pointer', fontWeight: 600 },
  dangerBtn: { padding: '4px 10px', fontSize: 12, border: '1px solid #fca5a5', color: '#b91c1c', borderRadius: 5, background: '#fff', cursor: 'pointer' },
  errBox: { background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: 8, borderRadius: 6, fontSize: 13, marginBottom: 10 },
}

const EMPTY = { name: '', agency: '', start_date: '', end_date: '', contract_amount: '', actual_amount: '', description: '' }
const PART_EMPTY = { employee_id: '', role: '', company_at_time: '', participation_rate: '' }

function fmtAmount(n) {
  if (n == null || n === '') return '-'
  const num = Number(n)
  if (Number.isNaN(num)) return String(n)
  return num.toLocaleString('ko-KR') + '원'
}

export default function BidProject() {
  const nav = useNavigate()
  const [list, setList] = useState([])
  const [err, setErr] = useState(null)
  const [adding, setAdding] = useState(false)
  const [editId, setEditId] = useState(null)
  const [draft, setDraft] = useState(EMPTY)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(null)   // 펼친 row id
  const [participants, setParticipants] = useState({})  // { projectId: [...] }
  const [employees, setEmployees] = useState([])         // 직원 dropdown용
  const [partDraft, setPartDraft] = useState({})         // { projectId: PART_EMPTY }
  const [partEditId, setPartEditId] = useState(null)     // 편집중인 participant.id

  const load = async () => {
    setErr(null)
    try {
      const r = await authFetch('/api/admin/bid-projects')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setList(j.items || [])
    } catch (e) { setErr(e.message) }
  }
  useEffect(() => { load() }, [])
  useEffect(() => {
    (async () => {
      try {
        const r = await authFetch('/api/admin/bid-employees')
        if (r.ok) {
          const j = await r.json()
          setEmployees(j.items || [])
        }
      } catch {}
    })()
  }, [])

  const loadParticipants = async (id) => {
    try {
      const r = await authFetch(`/api/admin/bid-projects/${id}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setParticipants(p => ({ ...p, [id]: j.participants || [] }))
    } catch (e) { setErr(e.message) }
  }
  const expand = async (id) => {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    if (!partDraft[id]) setPartDraft(d => ({ ...d, [id]: PART_EMPTY }))
    if (!participants[id]) await loadParticipants(id)
  }

  // 참여자 — 추가
  const addParticipant = async (projectId) => {
    const draft = partDraft[projectId] || PART_EMPTY
    if (!draft.employee_id) { setErr('직원을 선택하세요'); return }
    setErr(null)
    try {
      const r = await authFetch(`/api/admin/bid-projects/${projectId}/employees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: Number(draft.employee_id),
          role: draft.role || null,
          company_at_time: draft.company_at_time || null,
          participation_rate:
            draft.participation_rate === '' ? null : Number(draft.participation_rate),
        }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error || `HTTP ${r.status}`)
      }
      setPartDraft(d => ({ ...d, [projectId]: PART_EMPTY }))
      await loadParticipants(projectId)
    } catch (e) { setErr(e.message) }
  }

  // 참여자 — 수정 시작
  const startEditPart = (p) => {
    setPartEditId(p.id)
    setPartDraft(d => ({
      ...d,
      [`edit_${p.id}`]: {
        role: p.role || '',
        company_at_time: p.company_at_time || '',
        participation_rate: p.participation_rate ?? '',
      },
    }))
  }
  const saveEditPart = async (projectId, partId) => {
    const draft = partDraft[`edit_${partId}`]
    if (!draft) return
    try {
      const r = await authFetch(`/api/admin/bid-emp-projects/${partId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: draft.role || null,
          company_at_time: draft.company_at_time || null,
          participation_rate:
            draft.participation_rate === '' ? null : Number(draft.participation_rate),
        }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setPartEditId(null)
      await loadParticipants(projectId)
    } catch (e) { setErr(e.message) }
  }

  // 참여자 — 삭제
  const delParticipant = async (projectId, partId, name) => {
    if (!confirm(`참여자 "${name}" 제거?`)) return
    try {
      const r = await authFetch(`/api/admin/bid-emp-projects/${partId}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      await loadParticipants(projectId)
    } catch (e) { setErr(e.message) }
  }

  const startEdit = (it) => {
    setEditId(it.id); setAdding(false)
    setDraft({
      name: it.name, agency: it.agency || '',
      start_date: it.start_date || '', end_date: it.end_date || '',
      contract_amount: it.contract_amount ?? '',
      actual_amount: it.actual_amount ?? '',
      description: it.description || '',
    })
  }
  const reset = () => { setAdding(false); setEditId(null); setDraft(EMPTY) }

  const save = async (forNew) => {
    if (!draft.name) { setErr('프로젝트명 필수'); return }
    const body = {
      ...draft,
      contract_amount: draft.contract_amount === '' ? null : Number(draft.contract_amount),
      actual_amount: draft.actual_amount === '' ? null : Number(draft.actual_amount),
    }
    try {
      const url = forNew ? '/api/admin/bid-projects' : `/api/admin/bid-projects/${editId}`
      const r = await authFetch(url, {
        method: forNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      reset(); await load()
    } catch (e) { setErr(e.message) }
  }
  const del = async (id, name) => {
    if (!confirm(`"${name}" 삭제? (모든 참여 기록도 함께 삭제됩니다)`)) return
    try {
      const r = await authFetch(`/api/admin/bid-projects/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      await load()
    } catch (e) { setErr(e.message) }
  }

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return list
    return list.filter(p =>
      p.name.toLowerCase().includes(s) ||
      (p.agency || '').toLowerCase().includes(s)
    )
  }, [list, search])

  const Row = ({ forNew }) => (
    <tr style={{ background: '#fff7ed' }}>
      <td className="mono">{forNew ? '신규' : editId}</td>
      <td><input style={S.input} value={draft.name} onChange={e => setDraft(d => ({...d, name: e.target.value}))} placeholder="프로젝트명*" /></td>
      <td><input style={S.input} value={draft.agency} onChange={e => setDraft(d => ({...d, agency: e.target.value}))} placeholder="발주기관" /></td>
      <td><input style={S.input} type="date" value={draft.start_date} onChange={e => setDraft(d => ({...d, start_date: e.target.value}))} /></td>
      <td><input style={S.input} type="date" value={draft.end_date} onChange={e => setDraft(d => ({...d, end_date: e.target.value}))} /></td>
      <td><input style={S.input} type="number" value={draft.contract_amount} onChange={e => setDraft(d => ({...d, contract_amount: e.target.value}))} placeholder="계약(원)" /></td>
      <td><input style={S.input} type="number" value={draft.actual_amount} onChange={e => setDraft(d => ({...d, actual_amount: e.target.value}))} placeholder="실적(원)" /></td>
      <td><input style={S.input} value={draft.description} onChange={e => setDraft(d => ({...d, description: e.target.value}))} placeholder="설명" /></td>
      <td>
        <button style={S.primaryBtn} onClick={() => save(forNew)}>저장</button>{' '}
        <button style={S.miniBtn} onClick={reset}>취소</button>
      </td>
    </tr>
  )

  return (
    <div>
      <div className="page-head">
        <h2>입찰 — 유사사업</h2>
        <div className="page-sub">참여 사업 마스터 ({list.length}건)</div>
      </div>

      <div className="bar" style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <button className="btn-primary" onClick={() => { setAdding(true); setEditId(null); setDraft(EMPTY) }} disabled={adding}>
          + 신규 프로젝트
        </button>
        <input
          style={{ ...S.input, flex: 1, maxWidth: 320 }}
          placeholder="🔍 이름/발주기관 검색"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <span style={{ color: '#64748b', fontSize: 12 }}>표시: {filtered.length}건</span>
      </div>

      {err && <div style={S.errBox}>{err}</div>}

      <div className="table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th style={{ width: 50 }}>#</th>
              <th>프로젝트명</th>
              <th style={{ width: 180 }}>발주기관</th>
              <th style={{ width: 130 }}>시작일</th>
              <th style={{ width: 130 }}>종료일</th>
              <th style={{ width: 130 }}>계약금액</th>
              <th style={{ width: 130 }}>실적금액</th>
              <th>설명</th>
              <th style={{ width: 180 }}></th>
            </tr>
          </thead>
          <tbody>
            {adding && <Row forNew />}
            {filtered.map((it, idx) => (
              <Fragment key={it.id}>
                {editId === it.id ? <Row forNew={false} /> : (
                  <tr>
                    <td className="mono">{idx + 1}</td>
                    <td className="bold">{it.name}</td>
                    <td>{it.agency || '-'}</td>
                    <td className="mono small">{it.start_date || '-'}</td>
                    <td className="mono small">{it.end_date || '-'}</td>
                    <td className="mono small">{fmtAmount(it.contract_amount)}</td>
                    <td className="mono small">{fmtAmount(it.actual_amount)}</td>
                    <td className="small muted">{it.description || '-'}</td>
                    <td>
                      <button style={S.miniBtn} onClick={() => expand(it.id)}>
                        {expanded === it.id ? '닫기' : '참여자'}
                      </button>{' '}
                      <button style={S.miniBtn} onClick={() => startEdit(it)}>수정</button>{' '}
                      <button style={S.dangerBtn} onClick={() => del(it.id, it.name)}>삭제</button>
                    </td>
                  </tr>
                )}
                {expanded === it.id && (
                  <tr>
                    <td colSpan={9} style={{ background: '#f8fafc', padding: 12 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>참여자</div>
                      {!participants[it.id] && <div style={{ color: '#94a3b8', fontSize: 12 }}>로딩중…</div>}
                      {participants[it.id] && (
                        <table className="admin-table" style={{ fontSize: 12 }}>
                          <thead>
                            <tr>
                              <th style={{ width: 140 }}>성명</th>
                              <th style={{ width: 90 }}>직위</th>
                              <th>담당업무</th>
                              <th style={{ width: 150 }}>당시 소속</th>
                              <th style={{ width: 90 }}>투입률(%)</th>
                              <th style={{ width: 140 }}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {participants[it.id].map(p => {
                              const editing = partEditId === p.id
                              const ed = partDraft[`edit_${p.id}`] || PART_EMPTY
                              return (
                                <tr key={p.id}>
                                  <td className="bold">
                                    <a
                                      href={`/bid/employee/${p.employee_id}`}
                                      onClick={(e) => { e.preventDefault(); nav(`/bid/employee/${p.employee_id}`) }}
                                      style={{ color: '#1d4ed8', textDecoration: 'none' }}
                                    >{p.name}</a>
                                  </td>
                                  <td>{p.position || '-'}</td>
                                  {editing ? (
                                    <>
                                      <td><input style={S.input} value={ed.role}
                                        onChange={e => setPartDraft(d => ({ ...d, [`edit_${p.id}`]: { ...ed, role: e.target.value } }))}
                                        placeholder="담당업무" /></td>
                                      <td><input style={S.input} value={ed.company_at_time}
                                        onChange={e => setPartDraft(d => ({ ...d, [`edit_${p.id}`]: { ...ed, company_at_time: e.target.value } }))}
                                        placeholder="당시 소속" /></td>
                                      <td><input style={S.input} type="number" value={ed.participation_rate}
                                        onChange={e => setPartDraft(d => ({ ...d, [`edit_${p.id}`]: { ...ed, participation_rate: e.target.value } }))}
                                        placeholder="%" /></td>
                                      <td>
                                        <button style={S.primaryBtn} onClick={() => saveEditPart(it.id, p.id)}>저장</button>{' '}
                                        <button style={S.miniBtn} onClick={() => setPartEditId(null)}>취소</button>
                                      </td>
                                    </>
                                  ) : (
                                    <>
                                      <td>{p.role || '-'}</td>
                                      <td>{p.company_at_time || '-'}</td>
                                      <td className="mono">{p.participation_rate != null ? `${p.participation_rate}%` : '-'}</td>
                                      <td>
                                        <button style={S.miniBtn} onClick={() => startEditPart(p)}>수정</button>{' '}
                                        <button style={S.dangerBtn} onClick={() => delParticipant(it.id, p.id, p.name)}>제거</button>
                                      </td>
                                    </>
                                  )}
                                </tr>
                              )
                            })}

                            {/* 추가 폼 */}
                            <tr style={{ background: '#fff7ed' }}>
                              <td>
                                <select
                                  style={S.input}
                                  value={partDraft[it.id]?.employee_id || ''}
                                  onChange={e => setPartDraft(d => ({ ...d, [it.id]: { ...(d[it.id] || PART_EMPTY), employee_id: e.target.value } }))}
                                >
                                  <option value="">— 직원 —</option>
                                  {employees
                                    .filter(emp => !participants[it.id]?.some(pp => pp.employee_id === emp.id))
                                    .map(emp => (
                                      <option key={emp.id} value={emp.id}>
                                        {emp.name}{emp.position ? ` (${emp.position})` : ''}
                                      </option>
                                    ))}
                                </select>
                              </td>
                              <td className="small muted">자동</td>
                              <td><input style={S.input} value={partDraft[it.id]?.role || ''}
                                onChange={e => setPartDraft(d => ({ ...d, [it.id]: { ...(d[it.id] || PART_EMPTY), role: e.target.value } }))}
                                placeholder="담당업무" /></td>
                              <td><input style={S.input} value={partDraft[it.id]?.company_at_time || ''}
                                onChange={e => setPartDraft(d => ({ ...d, [it.id]: { ...(d[it.id] || PART_EMPTY), company_at_time: e.target.value } }))}
                                placeholder="당시 소속" /></td>
                              <td><input style={S.input} type="number" value={partDraft[it.id]?.participation_rate || ''}
                                onChange={e => setPartDraft(d => ({ ...d, [it.id]: { ...(d[it.id] || PART_EMPTY), participation_rate: e.target.value } }))}
                                placeholder="%" /></td>
                              <td>
                                <button style={S.primaryBtn} onClick={() => addParticipant(it.id)}>+ 추가</button>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {!filtered.length && !adding && (
              <tr><td colSpan={9} style={{ textAlign: 'center', color: '#94a3b8', padding: 24 }}>
                {search ? '검색 결과 없음' : '등록된 프로젝트가 없습니다. + 신규 프로젝트를 눌러 추가하세요.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
