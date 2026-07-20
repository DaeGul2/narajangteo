import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { authFetch } from '../auth.js'

export default function OverseasNoticeDetail() {
  const { id } = useParams()
  const [item, setItem] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    (async () => {
      setErr(null)
      try {
        const r = await authFetch(`/api/admin/overseas/notices/${id}`)
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        setItem(await r.json())
      } catch (e) { setErr(e.message) }
    })()
  }, [id])

  if (err) return <div className="error">{err}</div>
  if (!item) return <div className="empty">불러오는 중</div>

  return (
    <div>
      <div className="page-head">
        <h2>{item.title}</h2>
        <div className="page-sub">
          <Link to="/overseas/notices">← 해외 공고 목록</Link>
        </div>
      </div>

      <div className="run-box" style={{ maxWidth: 720 }}>
        <div className="kv"><span>출처</span><b>{item.source || '-'}</b></div>
        <div className="kv"><span>식별자</span><b className="mono">{item.notice_key}</b></div>
        <div className="kv"><span>기관</span><b>{item.organization || '-'}</b></div>
        <div className="kv"><span>국가</span><b>{item.country || '-'}</b></div>
        <div className="kv"><span>게시일</span><b>{item.posted_at || '-'}</b></div>
        <div className="kv"><span>마감일</span><b>{item.deadline || '-'}</b></div>
        <div className="kv">
          <span>원문 링크</span>
          <b>
            {item.url
              ? <a href={item.url} target="_blank" rel="noreferrer">{item.url}</a>
              : '-'}
          </b>
        </div>
        <div className="kv">
          <span>메일 발송</span>
          <b>{item.email_sent_at ? new Date(item.email_sent_at).toLocaleString('ko-KR') : '미발송'}</b>
        </div>
        <div className="kv">
          <span>저장일</span>
          <b>{item.created_at ? new Date(item.created_at).toLocaleString('ko-KR') : '-'}</b>
        </div>
      </div>

      {item.summary_md && (
        <>
          <h3 style={{ marginTop: 24 }}>요약</h3>
          <pre className="summary-pre">{item.summary_md}</pre>
        </>
      )}
    </div>
  )
}
