import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { authFetch } from '../auth.js'

function formatSize(b) {
  if (!b || isNaN(b)) return '-'
  if (b < 1024) return `${b} B`
  if (b < 1024*1024) return `${(b/1024).toFixed(1)} KB`
  return `${(b/1024/1024).toFixed(2)} MB`
}

export default function AdminNoticeDetail() {
  const { bidNo } = useParams()
  const [item, setItem] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    (async () => {
      try {
        const r = await authFetch(`/api/admin/notices/${encodeURIComponent(bidNo)}`)
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        setItem(await r.json())
      } catch (e) { setErr(e.message) }
    })()
  }, [bidNo])

  if (err) return <div className="error">{err}</div>
  if (!item) return <div className="empty">불러오는 중</div>

  let detail = {}
  try { detail = typeof item.detail === 'string' ? JSON.parse(item.detail) : (item.detail || {}) } catch {}
  let prev = []
  try { prev = typeof item.prev_history === 'string' ? JSON.parse(item.prev_history) : (item.prev_history || []) } catch {}

  return (
    <div>
      <Link to="/admin/notices" className="back-link">← 공고 목록</Link>
      <div className="page-head">
        <h2>{item.name}</h2>
        <div className="bidno-line">
          <span className="mono">{item.bid_no}</span>
          {item.ai_is_agent === 1 && <span className="badge agent">채용대행</span>}
          {item.ai_is_agent === 0 && <span className="badge other">그 외</span>}
        </div>
      </div>

      <div className="detail-meta">
        <div><b>공고기관</b> {item.agency || '-'}</div>
        <div><b>수요기관</b> {item.demander || '-'}</div>
        <div><b>사업금액</b> {item.bgt_amt || '-'}</div>
        <div><b>상태</b> {item.status || '-'}</div>
        <div><b>게시</b> {item.posted_at || '-'}</div>
        <div><b>마감</b> {item.deadline || '-'}</div>
      </div>

      {item.ai_reason && (
        <div className="ai-judge">
          <span className="lbl">AI 분류 근거</span>
          <span>{item.ai_reason}</span>
        </div>
      )}

      {item.summary_md && (
        <section className="section">
          <h3 className="section-h">요약</h3>
          <pre className="summary-pre">{item.summary_md}</pre>
        </section>
      )}

      {prev.length > 0 && (
        <section className="section">
          <h3 className="section-h">이전 채용대행 기록</h3>
          <div className="prev-list">
            {prev.map((p, i) => (
              <span key={i} className="prev-item">
                <b>{p.year}</b><span>{(p.agencies || []).join(', ')}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <h3 className="section-h">첨부 파일</h3>
        {(item.disk_files && item.disk_files.length > 0) ? (
          <table className="admin-table">
            <thead>
              <tr><th>파일명</th><th style={{width:100}}>크기</th><th style={{width:100}}></th></tr>
            </thead>
            <tbody>
              {item.disk_files.map((f, i) => (
                <tr key={i}>
                  <td>{f.name}</td>
                  <td className="mono">{formatSize(f.size)}</td>
                  <td>
                    <a
                      href={`/api/admin/notices/${encodeURIComponent(item.bid_no)}/files/${encodeURIComponent(f.name)}`}
                      onClick={async (e) => {
                        e.preventDefault()
                        const r = await authFetch(e.currentTarget.href)
                        if (!r.ok) return alert('다운로드 실패')
                        const blob = await r.blob()
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url; a.download = f.name
                        document.body.appendChild(a); a.click(); a.remove()
                        URL.revokeObjectURL(url)
                      }}
                      className="dl-btn"
                    >다운로드</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">보관된 파일 없음</div>
        )}
      </section>

      {detail.dmstPic && detail.dmstPic.length > 0 && (
        <section className="section">
          <h3 className="section-h">수요기관 담당자</h3>
          <table className="admin-table">
            <thead><tr><th>수요기관</th><th>부서</th><th>담당</th><th>전화</th><th>이메일</th></tr></thead>
            <tbody>
              {detail.dmstPic.map((p, i) => (
                <tr key={i}>
                  <td>{p.dmstUntyGrpNm}</td>
                  <td>{p.deptNm}</td>
                  <td>{p.picNm}</td>
                  <td className="mono">{p.tlphNo}</td>
                  <td>{p.eml || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
