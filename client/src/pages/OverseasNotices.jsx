import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { authFetch } from '../auth.js'
import Pagination, { usePagination } from '../components/Pagination.jsx'

export default function OverseasNotices() {
  const [items, setItems] = useState([])
  const [q, setQ] = useState('')
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
    if (!q) return true
    const s = q.toLowerCase()
    return (i.title || '').toLowerCase().includes(s)
      || (i.organization || '').toLowerCase().includes(s)
      || (i.country || '').toLowerCase().includes(s)
      || (i.source || '').toLowerCase().includes(s)
  }), [items, q])

  const { pageItems, ...pager } = usePagination(filtered, 20)

  return (
    <div>
      <div className="page-head">
        <h2>해외 공고 목록</h2>
        <div className="page-sub">자동 수집된 해외 공고 ({filtered.length}건)</div>
      </div>

      <div className="filter-bar">
        <input
          placeholder="제목·기관·국가·출처 검색"
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
            <th style={{width:90}}>출처</th>
            <th>제목</th>
            <th style={{width:160}}>기관</th>
            <th style={{width:90}}>국가</th>
            <th style={{width:100}}>게시일</th>
            <th style={{width:100}}>마감일</th>
            <th style={{width:50,textAlign:'center'}}>요약</th>
            <th style={{width:90}}>저장일</th>
          </tr>
        </thead>
        <tbody>
          {pageItems.map(it => (
            <tr key={it.id}>
              <td className="muted small">{it.source || '-'}</td>
              <td>
                <Link to={`/overseas/notices/${it.id}`}>{it.title}</Link>
              </td>
              <td className="muted">{it.organization || '-'}</td>
              <td className="muted">{it.country || '-'}</td>
              <td className="muted small">{it.posted_at || '-'}</td>
              <td className="muted small">{it.deadline || '-'}</td>
              <td className="center">{it.has_summary ? '○' : '−'}</td>
              <td className="muted small">
                {it.created_at ? new Date(it.created_at).toLocaleDateString('ko-KR') : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Pagination {...pager} />
    </div>
  )
}
