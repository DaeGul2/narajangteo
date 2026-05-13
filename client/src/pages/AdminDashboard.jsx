import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { authFetch } from '../auth.js'

export default function AdminDashboard() {
  const [stats, setStats] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    (async () => {
      try {
        const r = await authFetch('/api/admin/stats')
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        setStats(await r.json())
      } catch (e) { setErr(e.message) }
    })()
  }, [])

  if (err) return <div className="error">{err}</div>
  if (!stats) return <div className="empty">불러오는 중</div>

  const lr = stats.last_run
  return (
    <div>
      <div className="page-head">
        <h2>대시보드</h2>
        <div className="page-sub">자동 수집·분류 현황 요약</div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">보관 공고</div>
          <div className="stat-val">{stats.notices_total}</div>
        </div>
        <div className="stat-card accent">
          <div className="stat-label">AI 판단: 채용대행</div>
          <div className="stat-val">{stats.notices_agent}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">AI 판단: 그 외</div>
          <div className="stat-val">{stats.notices_other}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">활성 수신자</div>
          <div className="stat-val">{stats.recipients_active}</div>
        </div>
      </div>

      <h3 className="section-h">최근 cron 실행</h3>
      {lr ? (
        <div className="run-box">
          <div className="kv"><span>시작</span><b>{new Date(lr.started_at).toLocaleString('ko-KR')}</b></div>
          <div className="kv"><span>완료</span><b>{lr.finished_at ? new Date(lr.finished_at).toLocaleString('ko-KR') : '-'}</b></div>
          <div className="kv"><span>상태</span><b><span className={`badge ${lr.status}`}>{lr.status}</span></b></div>
          <div className="kv"><span>결과</span><b>검색 {lr.total_found} · 신규 {lr.new_count} · 메일 {lr.email_sent ? '발송' : '미발송'}</b></div>
        </div>
      ) : <div className="empty">실행 기록이 없습니다</div>}

      <div className="quick-links">
        <Link to="/admin/notices" className="btn-link">공고 목록 보기</Link>
        <Link to="/admin/recipients" className="btn-link secondary">수신자 관리</Link>
      </div>
    </div>
  )
}
