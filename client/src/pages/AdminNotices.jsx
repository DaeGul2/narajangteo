import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { authFetch } from '../auth.js'

export default function AdminNotices() {
  const [items, setItems] = useState([])
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)

  const load = async () => {
    setLoading(true); setErr(null)
    try {
      const r = await authFetch(`/api/admin/notices?filter=${filter}&limit=300`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setItems(j.items || [])
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [filter])

  const filtered = items.filter(i => {
    if (!q) return true
    const s = q.toLowerCase()
    return (i.name || '').toLowerCase().includes(s)
      || (i.bid_no || '').toLowerCase().includes(s)
      || (i.demander || '').toLowerCase().includes(s)
      || (i.agency || '').toLowerCase().includes(s)
  })

  return (
    <div>
      <div className="page-head">
        <h2>공고 목록</h2>
        <div className="page-sub">자동 수집된 공고 ({filtered.length}건)</div>
      </div>

      <div className="filter-bar">
        <select value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="all">전체</option>
          <option value="agent">채용대행만</option>
          <option value="other">그 외</option>
        </select>
        <input
          placeholder="공고명·번호·기관 검색"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        <button onClick={load} disabled={loading}>{loading ? '...' : '새로고침'}</button>
      </div>

      {err && <div className="error">{err}</div>}

      <table className="admin-table">
        <thead>
          <tr>
            <th style={{width:160}}>공고번호</th>
            <th>공고명</th>
            <th style={{width:140}}>수요기관</th>
            <th style={{width:88,textAlign:'center'}}>분류</th>
            <th style={{width:50,textAlign:'center'}}>파일</th>
            <th style={{width:60,textAlign:'center'}}>이전</th>
            <th style={{width:50,textAlign:'center'}}>요약</th>
            <th style={{width:90}}>저장일</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(it => (
            <tr key={it.bid_no}>
              <td className="mono">
                <Link to={`/admin/notices/${encodeURIComponent(it.bid_no)}`}>
                  {it.bid_no}
                </Link>
              </td>
              <td>{it.name}</td>
              <td className="muted">{it.demander || it.agency || '-'}</td>
              <td className="center">
                {it.ai_is_agent === 1 ? <span className="badge agent">채용대행</span>
                  : it.ai_is_agent === 0 ? <span className="badge other">기타</span>
                  : <span className="badge unknown">미정</span>}
              </td>
              <td className="center">{it.files_n || 0}</td>
              <td className="center">{it.prev_n || 0}</td>
              <td className="center">{it.has_summary ? '○' : '−'}</td>
              <td className="muted small">
                {it.created_at ? new Date(it.created_at).toLocaleDateString('ko-KR') : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
