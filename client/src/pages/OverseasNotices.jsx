import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { authFetch } from '../auth.js'
import Pagination, { usePagination } from '../components/Pagination.jsx'

export default function OverseasNotices() {
  const [items, setItems] = useState([])
  const [q, setQ] = useState('')
  const [grade, setGrade] = useState('AB')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)

  const load = async () => {
    setLoading(true); setErr(null)
    try {
      const r = await authFetch('/api/admin/overseas/notices?limit=5000')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setItems(j.items || [])
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => items.filter(i => {
    if (grade === 'AB' && !(i.grade === 'A' || i.grade === 'B' || i.grade == null)) return false
    if (grade === 'A' && i.grade !== 'A') return false
    if (grade === 'B' && i.grade !== 'B') return false
    if (grade === 'X' && i.grade !== 'X') return false
    if (!q) return true
    const s = q.toLowerCase()
    return (i.title || '').toLowerCase().includes(s)
      || (i.organization || '').toLowerCase().includes(s)
      || (i.topic || '').toLowerCase().includes(s)
      || (i.source || '').toLowerCase().includes(s)
  }), [items, q, grade])

  const dday = (dl) => {
    if (!dl) return null
    const m = String(dl).match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (!m) return null
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3])
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }).split('-').map(Number)
    return Math.round((t - Date.UTC(today[0], today[1] - 1, today[2])) / 86400000)
  }

  const { pageItems, ...pager } = usePagination(filtered, 20)

  return (
    <div>
      <div className="page-head">
        <h2>해외 공고 목록</h2>
        <div className="page-sub">자동 수집된 해외 공고 ({filtered.length}건)</div>
      </div>

      <div className="filter-bar">
        <select value={grade} onChange={e => setGrade(e.target.value)}>
          <option value="AB">A+B (메일 대상)</option>
          <option value="A">A · 태국 확정</option>
          <option value="B">B · 동남아·아세안</option>
          <option value="X">X · 제외</option>
          <option value="ALL">전체</option>
        </select>
        <input
          placeholder="제목·기관·주제·출처 검색"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        <button onClick={load} disabled={loading}>{loading ? '...' : '새로고침'}</button>
      </div>

      {err && <div className="error">{err}</div>}

      {!err && !loading && items.length === 0 && (
        <div className="empty">아직 수집된 공고가 없습니다. 크롤러 구현 후 스케줄을 활성화하세요.</div>
      )}

      <table className="admin-table">
        <thead>
          <tr>
            <th style={{width:44,textAlign:'center'}}>등급</th>
            <th style={{width:70}}>출처</th>
            <th>제목</th>
            <th style={{width:150}}>기관</th>
            <th style={{width:56}}>유형</th>
            <th style={{width:120}}>금액</th>
            <th style={{width:90}}>게시일</th>
            <th style={{width:120}}>마감 (D-day)</th>
            <th style={{width:50,textAlign:'center'}}>메일</th>
          </tr>
        </thead>
        <tbody>
          {pageItems.map(it => (
            <tr key={it.id} className={it.grade === 'X' ? 'inactive' : ''}>
              <td className="center">
                {it.grade === 'A' ? <span className="badge agent">A</span>
                  : it.grade === 'B' ? <span className="badge unknown">B</span>
                  : it.grade === 'X' ? <span className="badge other">X</span>
                  : <span className="muted">−</span>}
              </td>
              <td className="muted small">{it.source || '-'}</td>
              <td>
                <Link to={`/overseas/notices/${it.id}`}>{it.title}</Link>
                {it.topic && <div className="small muted">{it.topic}</div>}
              </td>
              <td className="muted small">{it.organization || '-'}</td>
              <td className="muted small">{it.notice_type || '-'}</td>
              <td className="small">{it.amount || <span className="muted">−</span>}</td>
              <td className="muted small">{it.posted_at || '-'}</td>
              <td className="small">
                {it.deadline
                  ? <>{it.deadline}{(() => { const d = dday(it.deadline); return d == null ? '' : d < 0 ? <span className="muted"> 마감</span> : <b style={{ color: d <= 7 ? '#b45309' : '#0f766e' }}> D-{d}</b> })()}</>
                  : <span className="muted">-</span>}
              </td>
              <td className="center">{it.email_sent_at ? '○' : '−'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <Pagination {...pager} />
    </div>
  )
}
