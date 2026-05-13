// 직원 1명 기준의 통합 상세 페이지
// 탭: 기본정보 / 학력 / 경력 / 자격증 / 유사사업
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { authFetch } from '../auth.js'

// ─ 작은 헬퍼 ─
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
// ─ 공용 스타일 ─
const S = {
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 12 },
  cardHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, borderBottom: '1px solid #f3f4f6', paddingBottom: 8 },
  cardTitle: { fontSize: 15, fontWeight: 700, color: '#0f172a' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 11, color: '#64748b', fontWeight: 600, letterSpacing: 0.5 },
  input: { padding: '7px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, background: '#fff' },
  tabBar: { display: 'flex', gap: 4, borderBottom: '1px solid #e5e7eb', marginBottom: 16 },
  tab: (active) => ({
    padding: '8px 16px', fontSize: 13, fontWeight: active ? 700 : 500,
    color: active ? '#0f172a' : '#64748b',
    background: active ? '#fff' : 'transparent',
    border: active ? '1px solid #e5e7eb' : '1px solid transparent',
    borderBottom: active ? '1px solid #fff' : '1px solid #e5e7eb',
    borderRadius: '6px 6px 0 0', cursor: 'pointer', marginBottom: -1,
  }),
  miniBtn: { padding: '4px 10px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 5, background: '#fff', cursor: 'pointer' },
  primaryBtn: { padding: '5px 12px', fontSize: 12, border: 'none', borderRadius: 5, background: '#1d4ed8', color: '#fff', cursor: 'pointer', fontWeight: 600 },
  dangerBtn: { padding: '4px 10px', fontSize: 12, border: '1px solid #fca5a5', color: '#b91c1c', borderRadius: 5, background: '#fff', cursor: 'pointer' },
  errBox: { background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: 8, borderRadius: 6, fontSize: 13, marginBottom: 10 },
}

export default function BidEmployeeDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const empId = Number(id)
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [tab, setTab] = useState('basic')

  const load = async () => {
    setErr(null)
    try {
      const r = await authFetch(`/api/admin/bid-employees/${empId}/full`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setData(j)
    } catch (e) { setErr(e.message) }
  }
  useEffect(() => { if (empId) load() }, [empId])

  if (!empId) return <div>잘못된 직원 ID</div>
  if (err && !data) return <div style={S.errBox}>로드 실패: {err}</div>
  if (!data) return <div style={{ padding: 24, color: '#64748b' }}>로딩중…</div>

  const e = data.employee

  return (
    <div>
      <div className="page-head" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button style={S.miniBtn} onClick={() => nav('/bid/employee')}>← 목록</button>
        <h2 style={{ margin: 0 }}>
          {e.name}
          {e.name_en && <span style={{ color: '#64748b', fontWeight: 400, fontSize: 14, marginLeft: 8 }}>({e.name_en})</span>}
        </h2>
        <span style={{ fontSize: 12, color: '#64748b' }}>
          {e.position || '-'} · {ageInYears(e.birth_date) ?? '?'}세
          {!e.active && <span style={{ color: '#dc2626', marginLeft: 8 }}>· 비활성</span>}
        </span>
      </div>

      <div style={S.tabBar}>
        {[
          ['basic',   '기본정보'],
          ['edu',     `학력 (${data.educations.length})`],
          ['career',  `경력 (${data.careers.length})`],
          ['cert',    `자격증 (${data.certifications.length})`],
          ['project', `유사사업 (${data.projects.length})`],
        ].map(([k, label]) => (
          <button key={k} type="button" style={S.tab(tab === k)} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {err && <div style={S.errBox}>{err}</div>}

      {tab === 'basic'   && <BasicTab employee={e} onSaved={load} setErr={setErr} />}
      {tab === 'edu'     && <EducationsTab empId={empId} items={data.educations} onChange={load} setErr={setErr} />}
      {tab === 'career'  && <CareersTab empId={empId} items={data.careers} onChange={load} setErr={setErr} />}
      {tab === 'cert'    && <CertsTab empId={empId} items={data.certifications} onChange={load} setErr={setErr} />}
      {tab === 'project' && <ProjectsTab empId={empId} items={data.projects} onChange={load} setErr={setErr} />}
    </div>
  )
}

// ─── 기본정보 ───
function BasicTab({ employee, onSaved, setErr }) {
  const [draft, setDraft] = useState({ ...employee })
  useEffect(() => { setDraft({ ...employee }) }, [employee.id])

  const fld = (k) => (e) => setDraft(d => ({ ...d, [k]: e.target.value }))
  const fldBool = (k) => (e) => setDraft(d => ({ ...d, [k]: e.target.checked ? 1 : 0 }))

  const save = async () => {
    setErr(null)
    try {
      const r = await authFetch(`/api/admin/bid-employees/${employee.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      await onSaved()
    } catch (e) { setErr(e.message) }
  }

  const F = ({ label, k, type = 'text', placeholder }) => (
    <div style={S.field}>
      <span style={S.label}>{label}</span>
      <input style={S.input} type={type} value={draft[k] ?? ''} onChange={fld(k)} placeholder={placeholder} />
    </div>
  )

  return (
    <div style={S.card}>
      <div style={S.cardHead}>
        <span style={S.cardTitle}>기본 정보</span>
        <div>
          <label style={{ fontSize: 12, marginRight: 12, color: '#64748b' }}>
            <input type="checkbox" checked={!!draft.active} onChange={fldBool('active')} /> 활성
          </label>
          <button style={S.primaryBtn} onClick={save}>저장</button>
        </div>
      </div>
      <div style={S.grid}>
        <F label="성명" k="name" placeholder="홍길동" />
        <F label="영문이름" k="name_en" placeholder="Hong Gildong" />
        <F label="생년월일" k="birth_date" type="date" />
        <F label="전화" k="phone" placeholder="031-..." />
        <F label="이메일" k="email" type="email" />
        <F label="직위" k="position" placeholder="수석파트장" />
        <F label="대표 학위" k="final_edu" placeholder="학사 / 석사 / 박사" />
        <F label="대표 학교" k="school" />
        <F label="대표 전공" k="major" />
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ ...S.field, flex: 1 }}>
            <span style={S.label}>졸업 연</span>
            <input style={S.input} type="number" value={draft.grad_year ?? ''} onChange={fld('grad_year')} />
          </div>
          <div style={{ ...S.field, flex: 1 }}>
            <span style={S.label}>졸업 월</span>
            <input style={S.input} type="number" value={draft.grad_month ?? ''} onChange={fld('grad_month')} />
          </div>
        </div>
        <F label="외부용 입사일" k="external_join_date" type="date" />
        <F label="실제 입사일" k="real_join_date" type="date" />
      </div>
      <div style={{ marginTop: 10, fontSize: 11, color: '#64748b' }}>
        ※ "대표" 항목들은 빠른 표시용 캐시입니다. 정식 학력은 학력 탭에서 관리하세요.
      </div>
    </div>
  )
}

// ─── 공통: 인라인 add/edit row 패턴 ───
function useCrud(basePath, childPath, onChange, setErr) {
  const post = async (body) => {
    setErr(null)
    try {
      const r = await authFetch(basePath, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      await onChange()
      return true
    } catch (e) { setErr(e.message); return false }
  }
  const patch = async (id, body) => {
    setErr(null)
    try {
      const r = await authFetch(`${childPath}/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      await onChange()
      return true
    } catch (e) { setErr(e.message); return false }
  }
  const del = async (id) => {
    if (!confirm('삭제할까요?')) return
    setErr(null)
    try {
      const r = await authFetch(`${childPath}/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      await onChange()
    } catch (e) { setErr(e.message) }
  }
  return { post, patch, del }
}

// ─── 학력 ───
const DEGREES = ['고졸', '전문학사', '학사', '석사', '박사', '기타']
const EDU_EMPTY = { degree: '학사', school: '', major: '', graduated_at: '', thesis: '' }

function EducationsTab({ empId, items, onChange, setErr }) {
  const { post, patch, del } = useCrud(`/api/admin/bid-employees/${empId}/educations`, `/api/admin/bid-educations`, onChange, setErr)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState(EDU_EMPTY)
  const [editId, setEditId] = useState(null)

  const startEdit = (it) => { setEditId(it.id); setAdding(false); setDraft({
    degree: it.degree, school: it.school || '', major: it.major || '',
    graduated_at: it.graduated_at || '', thesis: it.thesis || '',
  })}
  const reset = () => { setAdding(false); setEditId(null); setDraft(EDU_EMPTY) }

  const Row = ({ forNew }) => (
    <tr style={{ background: '#fff7ed' }}>
      <td className="mono">{forNew ? '신규' : editId}</td>
      <td>
        <select style={S.input} value={draft.degree} onChange={e => setDraft(d => ({...d, degree: e.target.value}))}>
          {DEGREES.map(d => <option key={d}>{d}</option>)}
        </select>
      </td>
      <td><input style={S.input} value={draft.school} onChange={e => setDraft(d => ({...d, school: e.target.value}))} placeholder="학교명" /></td>
      <td><input style={S.input} value={draft.major} onChange={e => setDraft(d => ({...d, major: e.target.value}))} placeholder="전공" /></td>
      <td><input style={S.input} type="date" value={draft.graduated_at} onChange={e => setDraft(d => ({...d, graduated_at: e.target.value}))} /></td>
      <td><input style={S.input} value={draft.thesis} onChange={e => setDraft(d => ({...d, thesis: e.target.value}))} placeholder="(석/박사) 학위논문" /></td>
      <td>
        <button style={S.primaryBtn} onClick={async () => {
          if (!draft.school) { setErr('학교명 필수'); return }
          const ok = forNew ? await post(draft) : await patch(editId, draft)
          if (ok) reset()
        }}>저장</button>{' '}
        <button style={S.miniBtn} onClick={reset}>취소</button>
      </td>
    </tr>
  )

  return (
    <div style={S.card}>
      <div style={S.cardHead}>
        <span style={S.cardTitle}>학력 ({items.length})</span>
        {!adding && !editId && (
          <button style={S.primaryBtn} onClick={() => { setAdding(true); setDraft(EDU_EMPTY) }}>+ 추가</button>
        )}
      </div>
      <table className="admin-table">
        <thead>
          <tr>
            <th style={{ width: 50 }}>#</th>
            <th style={{ width: 90 }}>학위</th>
            <th style={{ width: 180 }}>학교</th>
            <th style={{ width: 160 }}>전공</th>
            <th style={{ width: 130 }}>졸업일</th>
            <th>학위논문</th>
            <th style={{ width: 140 }}></th>
          </tr>
        </thead>
        <tbody>
          {adding && <Row forNew />}
          {items.map((it, idx) => (
            editId === it.id ? <Row key={it.id} forNew={false} /> : (
              <tr key={it.id}>
                <td className="mono">{idx + 1}</td>
                <td>{it.degree}</td>
                <td className="bold">{it.school}</td>
                <td>{it.major || '-'}</td>
                <td className="mono small">{it.graduated_at || '-'}</td>
                <td className="small muted">{it.thesis || '-'}</td>
                <td>
                  <button style={S.miniBtn} onClick={() => startEdit(it)}>수정</button>{' '}
                  <button style={S.dangerBtn} onClick={() => del(it.id)}>삭제</button>
                </td>
              </tr>
            )
          ))}
          {!items.length && !adding && (
            <tr><td colSpan={7} style={{ textAlign: 'center', color: '#94a3b8', padding: 20 }}>등록된 학력 없음</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ─── 경력 ───
const CAREER_EMPTY = { org_name: '', start_date: '', end_date: '', position: '', duty: '' }

function CareersTab({ empId, items, onChange, setErr }) {
  const { post, patch, del } = useCrud(`/api/admin/bid-employees/${empId}/careers`, `/api/admin/bid-careers`, onChange, setErr)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState(CAREER_EMPTY)
  const [editId, setEditId] = useState(null)

  const startEdit = (it) => { setEditId(it.id); setAdding(false); setDraft({
    org_name: it.org_name, start_date: it.start_date || '', end_date: it.end_date || '',
    position: it.position || '', duty: it.duty || '',
  })}
  const reset = () => { setAdding(false); setEditId(null); setDraft(CAREER_EMPTY) }

  const Row = ({ forNew }) => (
    <tr style={{ background: '#fff7ed' }}>
      <td className="mono">{forNew ? '신규' : editId}</td>
      <td><input style={S.input} value={draft.org_name} onChange={e => setDraft(d => ({...d, org_name: e.target.value}))} placeholder="기관명" /></td>
      <td><input style={S.input} type="date" value={draft.start_date} onChange={e => setDraft(d => ({...d, start_date: e.target.value}))} /></td>
      <td>
        <input style={S.input} type="date" value={draft.end_date} onChange={e => setDraft(d => ({...d, end_date: e.target.value}))} />
        <span style={{ fontSize: 10, color: '#64748b' }}>(비우면 현재)</span>
      </td>
      <td><input style={S.input} value={draft.position} onChange={e => setDraft(d => ({...d, position: e.target.value}))} placeholder="직위" /></td>
      <td><input style={S.input} value={draft.duty} onChange={e => setDraft(d => ({...d, duty: e.target.value}))} placeholder="담당업무" /></td>
      <td>
        <button style={S.primaryBtn} onClick={async () => {
          if (!draft.org_name) { setErr('기관명 필수'); return }
          if (!draft.start_date) { setErr('입사일 필수'); return }
          const ok = forNew ? await post(draft) : await patch(editId, draft)
          if (ok) reset()
        }}>저장</button>{' '}
        <button style={S.miniBtn} onClick={reset}>취소</button>
      </td>
    </tr>
  )

  return (
    <div style={S.card}>
      <div style={S.cardHead}>
        <span style={S.cardTitle}>경력 ({items.length})</span>
        {!adding && !editId && (
          <button style={S.primaryBtn} onClick={() => { setAdding(true); setDraft(CAREER_EMPTY) }}>+ 추가</button>
        )}
      </div>
      <table className="admin-table">
        <thead>
          <tr>
            <th style={{ width: 50 }}>#</th>
            <th>기관</th>
            <th style={{ width: 130 }}>입사일</th>
            <th style={{ width: 140 }}>퇴사일</th>
            <th style={{ width: 110 }}>직위</th>
            <th>담당업무</th>
            <th style={{ width: 140 }}></th>
          </tr>
        </thead>
        <tbody>
          {adding && <Row forNew />}
          {items.map((it, idx) => (
            editId === it.id ? <Row key={it.id} forNew={false} /> : (
              <tr key={it.id}>
                <td className="mono">{idx + 1}</td>
                <td className="bold">{it.org_name}</td>
                <td className="mono small">{it.start_date}</td>
                <td className="mono small">{it.end_date || <span style={{ color: '#16a34a' }}>현재</span>}</td>
                <td>{it.position || '-'}</td>
                <td className="small">{it.duty || '-'}</td>
                <td>
                  <button style={S.miniBtn} onClick={() => startEdit(it)}>수정</button>{' '}
                  <button style={S.dangerBtn} onClick={() => del(it.id)}>삭제</button>
                </td>
              </tr>
            )
          ))}
          {!items.length && !adding && (
            <tr><td colSpan={7} style={{ textAlign: 'center', color: '#94a3b8', padding: 20 }}>등록된 경력 없음</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ─── 자격증 ───
const CERT_EMPTY = { name: '', acquired_at: '', issuer: '', cert_number: '' }

function CertsTab({ empId, items, onChange, setErr }) {
  const { post, patch, del } = useCrud(`/api/admin/bid-employees/${empId}/certifications`, `/api/admin/bid-certifications`, onChange, setErr)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState(CERT_EMPTY)
  const [editId, setEditId] = useState(null)

  const startEdit = (it) => { setEditId(it.id); setAdding(false); setDraft({
    name: it.name, acquired_at: it.acquired_at || '',
    issuer: it.issuer || '', cert_number: it.cert_number || '',
  })}
  const reset = () => { setAdding(false); setEditId(null); setDraft(CERT_EMPTY) }

  const Row = ({ forNew }) => (
    <tr style={{ background: '#fff7ed' }}>
      <td className="mono">{forNew ? '신규' : editId}</td>
      <td><input style={S.input} value={draft.name} onChange={e => setDraft(d => ({...d, name: e.target.value}))} placeholder="자격증명" /></td>
      <td><input style={S.input} type="date" value={draft.acquired_at} onChange={e => setDraft(d => ({...d, acquired_at: e.target.value}))} /></td>
      <td><input style={S.input} value={draft.issuer} onChange={e => setDraft(d => ({...d, issuer: e.target.value}))} placeholder="발급기관" /></td>
      <td><input style={S.input} value={draft.cert_number} onChange={e => setDraft(d => ({...d, cert_number: e.target.value}))} placeholder="자격번호" /></td>
      <td>
        <button style={S.primaryBtn} onClick={async () => {
          if (!draft.name) { setErr('자격증명 필수'); return }
          const ok = forNew ? await post(draft) : await patch(editId, draft)
          if (ok) reset()
        }}>저장</button>{' '}
        <button style={S.miniBtn} onClick={reset}>취소</button>
      </td>
    </tr>
  )

  return (
    <div style={S.card}>
      <div style={S.cardHead}>
        <span style={S.cardTitle}>자격증 ({items.length})</span>
        {!adding && !editId && (
          <button style={S.primaryBtn} onClick={() => { setAdding(true); setDraft(CERT_EMPTY) }}>+ 추가</button>
        )}
      </div>
      <table className="admin-table">
        <thead>
          <tr>
            <th style={{ width: 50 }}>#</th>
            <th>자격증명</th>
            <th style={{ width: 130 }}>취득일</th>
            <th style={{ width: 180 }}>발급기관</th>
            <th style={{ width: 180 }}>자격번호</th>
            <th style={{ width: 140 }}></th>
          </tr>
        </thead>
        <tbody>
          {adding && <Row forNew />}
          {items.map((it, idx) => (
            editId === it.id ? <Row key={it.id} forNew={false} /> : (
              <tr key={it.id}>
                <td className="mono">{idx + 1}</td>
                <td className="bold">{it.name}</td>
                <td className="mono small">{it.acquired_at || '-'}</td>
                <td>{it.issuer || '-'}</td>
                <td className="mono small">{it.cert_number || '-'}</td>
                <td>
                  <button style={S.miniBtn} onClick={() => startEdit(it)}>수정</button>{' '}
                  <button style={S.dangerBtn} onClick={() => del(it.id)}>삭제</button>
                </td>
              </tr>
            )
          ))}
          {!items.length && !adding && (
            <tr><td colSpan={6} style={{ textAlign: 'center', color: '#94a3b8', padding: 20 }}>등록된 자격증 없음</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ─── 유사사업 (project_id 선택 + 참여 메타 + 새 project 인라인 추가) ───
const EP_EMPTY = { project_id: '', role: '', company_at_time: '', participation_rate: '' }
const NEW_PROJ_EMPTY = { name: '', agency: '', start_date: '', end_date: '', contract_amount: '', description: '' }

function ProjectsTab({ empId, items, onChange, setErr }) {
  const { post, patch, del } = useCrud(`/api/admin/bid-employees/${empId}/projects`, `/api/admin/bid-emp-projects`, onChange, setErr)
  const [adding, setAdding] = useState(false)
  const [editId, setEditId] = useState(null)
  const [draft, setDraft] = useState(EP_EMPTY)
  const [allProjects, setAllProjects] = useState([])
  const [search, setSearch] = useState('')
  const [showNewProj, setShowNewProj] = useState(false)
  const [newProj, setNewProj] = useState(NEW_PROJ_EMPTY)

  const loadProjects = async () => {
    try {
      const r = await authFetch(`/api/admin/bid-projects`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setAllProjects(j.items || [])
    } catch (e) { setErr(e.message) }
  }
  useEffect(() => { loadProjects() }, [])

  // 이미 추가된 project_id 제외 + 검색 필터
  const usedIds = useMemo(() => new Set(items.map(i => i.project_id)), [items])
  const availableProjects = useMemo(() => {
    const s = search.trim().toLowerCase()
    return allProjects.filter(p => !usedIds.has(p.id))
      .filter(p => !s || p.name.toLowerCase().includes(s) || (p.agency || '').toLowerCase().includes(s))
  }, [allProjects, usedIds, search])

  const startEdit = (it) => { setEditId(it.id); setAdding(false); setDraft({
    project_id: it.project_id,
    role: it.role || '',
    company_at_time: it.company_at_time || '',
    participation_rate: it.participation_rate ?? '',
  })}
  const reset = () => { setAdding(false); setEditId(null); setDraft(EP_EMPTY); setShowNewProj(false); setNewProj(NEW_PROJ_EMPTY); setSearch('') }

  const saveNewProjectThenAttach = async () => {
    if (!newProj.name) { setErr('프로젝트명 필수'); return }
    try {
      const r = await authFetch(`/api/admin/bid-projects`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newProj,
          contract_amount: newProj.contract_amount === '' ? null : Number(newProj.contract_amount),
        }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setDraft(d => ({ ...d, project_id: j.id }))
      await loadProjects()
      setShowNewProj(false)
      setNewProj(NEW_PROJ_EMPTY)
    } catch (e) { setErr(e.message) }
  }

  const Row = ({ forNew }) => (
    <tr style={{ background: '#fff7ed' }}>
      <td className="mono">{forNew ? '신규' : editId}</td>
      <td colSpan={3}>
        {!forNew && (
          <div style={{ padding: 6, color: '#475569', fontSize: 12 }}>
            {items.find(i => i.id === editId)?.project_name}
          </div>
        )}
        {forNew && !showNewProj && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              style={{ ...S.input, flex: 1 }}
              placeholder="🔍 프로젝트명/발주기관 검색"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <select
              style={{ ...S.input, minWidth: 260 }}
              value={draft.project_id}
              onChange={e => setDraft(d => ({...d, project_id: e.target.value }))}
            >
              <option value="">-- 프로젝트 선택 --</option>
              {availableProjects.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.agency ? ` (${p.agency})` : ''}
                </option>
              ))}
            </select>
            <button type="button" style={S.miniBtn} onClick={() => setShowNewProj(true)}>+ 새 프로젝트</button>
          </div>
        )}
        {forNew && showNewProj && (
          <div style={{ background: '#fff', border: '1px dashed #d1d5db', padding: 8, borderRadius: 6 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
              <input style={S.input} placeholder="프로젝트명*" value={newProj.name} onChange={e => setNewProj(p => ({...p, name: e.target.value}))} />
              <input style={S.input} placeholder="발주기관" value={newProj.agency} onChange={e => setNewProj(p => ({...p, agency: e.target.value}))} />
              <input style={S.input} type="date" placeholder="시작일" value={newProj.start_date} onChange={e => setNewProj(p => ({...p, start_date: e.target.value}))} />
              <input style={S.input} type="date" placeholder="종료일" value={newProj.end_date} onChange={e => setNewProj(p => ({...p, end_date: e.target.value}))} />
              <input style={S.input} type="number" placeholder="계약금액(원)" value={newProj.contract_amount} onChange={e => setNewProj(p => ({...p, contract_amount: e.target.value}))} />
              <input style={S.input} placeholder="설명 (선택)" value={newProj.description} onChange={e => setNewProj(p => ({...p, description: e.target.value}))} />
            </div>
            <div>
              <button type="button" style={S.primaryBtn} onClick={saveNewProjectThenAttach}>프로젝트 생성</button>{' '}
              <button type="button" style={S.miniBtn} onClick={() => { setShowNewProj(false); setNewProj(NEW_PROJ_EMPTY) }}>취소</button>
            </div>
          </div>
        )}
      </td>
      <td><input style={S.input} value={draft.role} onChange={e => setDraft(d => ({...d, role: e.target.value}))} placeholder="담당업무" /></td>
      <td><input style={S.input} value={draft.company_at_time} onChange={e => setDraft(d => ({...d, company_at_time: e.target.value}))} placeholder="당시 소속" /></td>
      <td><input style={S.input} type="number" step="0.01" value={draft.participation_rate} onChange={e => setDraft(d => ({...d, participation_rate: e.target.value}))} placeholder="투입률(%)" /></td>
      <td>
        <button style={S.primaryBtn} onClick={async () => {
          if (forNew && !draft.project_id) { setErr('프로젝트 선택 필수'); return }
          const body = {
            project_id: forNew ? Number(draft.project_id) : undefined,
            role: draft.role,
            company_at_time: draft.company_at_time,
            participation_rate: draft.participation_rate === '' ? null : Number(draft.participation_rate),
          }
          const ok = forNew ? await post(body) : await patch(editId, body)
          if (ok) reset()
        }}>저장</button>{' '}
        <button style={S.miniBtn} onClick={reset}>취소</button>
      </td>
    </tr>
  )

  return (
    <div style={S.card}>
      <div style={S.cardHead}>
        <span style={S.cardTitle}>유사사업 수행경력 ({items.length})</span>
        {!adding && !editId && (
          <button style={S.primaryBtn} onClick={() => { setAdding(true); setDraft(EP_EMPTY) }}>+ 추가</button>
        )}
      </div>
      <table className="admin-table">
        <thead>
          <tr>
            <th style={{ width: 40 }}>#</th>
            <th>프로젝트명</th>
            <th style={{ width: 140 }}>발주기관</th>
            <th style={{ width: 180 }}>기간</th>
            <th style={{ width: 140 }}>담당업무</th>
            <th style={{ width: 110 }}>당시 소속</th>
            <th style={{ width: 90 }}>투입률</th>
            <th style={{ width: 140 }}></th>
          </tr>
        </thead>
        <tbody>
          {adding && <Row forNew />}
          {items.map((it, idx) => (
            editId === it.id ? <Row key={it.id} forNew={false} /> : (
              <tr key={it.id}>
                <td className="mono">{idx + 1}</td>
                <td className="bold">{it.project_name}</td>
                <td>{it.agency || '-'}</td>
                <td className="mono small">{it.start_date || '?'} ~ {it.end_date || '?'}</td>
                <td className="small">{it.role || '-'}</td>
                <td className="small">{it.company_at_time || '-'}</td>
                <td className="mono small">{it.participation_rate != null ? `${it.participation_rate}%` : '-'}</td>
                <td>
                  <button style={S.miniBtn} onClick={() => startEdit(it)}>수정</button>{' '}
                  <button style={S.dangerBtn} onClick={() => del(it.id)}>삭제</button>
                </td>
              </tr>
            )
          ))}
          {!items.length && !adding && (
            <tr><td colSpan={8} style={{ textAlign: 'center', color: '#94a3b8', padding: 20 }}>등록된 유사사업 없음</td></tr>
          )}
        </tbody>
      </table>
      <div style={{ marginTop: 10, fontSize: 11, color: '#64748b' }}>
        ※ 프로젝트의 이름·기관·기간·금액은 <a href="/bid/projects" style={{ color: '#1d4ed8' }}>유사사업 마스터</a>에서 통합 관리됩니다.
        여기서는 <b>이 사람의 참여 정보</b>(담당업무·당시소속·투입률)만 조정하세요.
      </div>
    </div>
  )
}
