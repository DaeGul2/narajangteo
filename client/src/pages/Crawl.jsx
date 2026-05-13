import { useState, Fragment } from 'react'

export default function Crawl() {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [elapsed, setElapsed] = useState(0)

  const runCrawl = async () => {
    setLoading(true)
    setError(null)
    setData(null)
    setElapsed(0)
    const t0 = Date.now()
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 500)
    try {
      const res = await fetch('/api/crawl', { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      clearInterval(timer)
      setLoading(false)
    }
  }

  return (
    <div className="app">
      <header>
        <h1>나라장터 입찰공고 '채용' 크롤러</h1>
        <p className="sub">
          용역(tab2) 탭에서 공고명에 '채용' 검색 후 100건을 가져와 실제 직원채용/기타로 자동 분류합니다. (헤드리스)
        </p>
      </header>

      <div className="controls">
        <button className="run-btn" onClick={runCrawl} disabled={loading}>
          {loading ? `⏳ 크롤링 중… ${elapsed}s` : '▶ 실행'}
        </button>
        {loading && (
          <p className="hint">
            SSO 리다이렉트 → 검색 → 100건 → 파싱 까지 보통 <b>30~60초</b> 정도 걸립니다.
          </p>
        )}
      </div>

      {error && (
        <div className="error">
          <b>에러:</b> {error}
          <div className="hint">서버가 http://127.0.0.1:3001 에서 떠 있는지 확인하세요.</div>
        </div>
      )}

      {data && (
        <>
          <div className="summary">
            전체 <b>{data.total}</b>건 → 실제 채용 <b className="ok">{data.recruitmentCount}</b>건 ·
            기타 <b className="muted">{data.otherCount}</b>건
          </div>

          <ResultTable
            title={`🤖 AI 판단 채용대행 용역 (${data.recruitmentCount}건)`}
            tone="ok"
            items={data.recruitment}
            showReason={false}
          />
          <ResultTable
            title={`❌ AI 판단: 그 외 채용업무 아웃소싱 (${data.otherCount}건)`}
            tone="muted"
            items={data.other}
            showReason
          />
        </>
      )}
    </div>
  )
}

function ResultTable({ title, tone, items, showReason }) {
  const [expanded, setExpanded] = useState({})
  const toggle = (i) => setExpanded((p) => ({ ...p, [i]: !p[i] }))

  if (!items || items.length === 0) {
    return (
      <section className={`section ${tone}`}>
        <h2>{title}</h2>
        <div className="empty">해당 없음</div>
      </section>
    )
  }
  const colSpan = showReason ? 7 : 6
  return (
    <section className={`section ${tone}`}>
      <h2>{title}</h2>
      <table>
        <thead>
          <tr>
            <th className="w-no">No</th>
            <th>공고명</th>
            <th className="w-agency">공고기관</th>
            <th className="w-money">사업금액<br/><span className="th-sub">(추정가격)</span></th>
            <th className="w-date">게시일시</th>
            <th className="w-status">상태</th>
            {showReason && <th className="w-reason">사유</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((r, i) => (
            <Fragment key={i}>
              <tr className={`row ${expanded[i] ? 'expanded' : ''}`} onClick={() => toggle(i)}>
                <td className="w-no">{r.no}</td>
                <td className="name">
                  <span className="caret">{expanded[i] ? '▼' : '▶'}</span>
                  {r.name}
                  <div className="bidno">{r.bidNo}</div>
                </td>
                <td>{r.agency}</td>
                <td className="w-money">
                  <div className="money-main">{r.bgtAmt || '-'}</div>
                  {r.prspPrce && r.prspPrce !== r.bgtAmt && (
                    <div className="money-sub">{r.prspPrce}</div>
                  )}
                </td>
                <td className="w-date">{(r.date || '').split('(')[0]}</td>
                <td className="w-status">{r.status}</td>
                {showReason && <td className="w-reason">{r.reason}</td>}
              </tr>
              {expanded[i] && (
                <tr className="detail-row">
                  <td colSpan={colSpan}>
                    <DetailPanel item={r} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function formatPhone(s) {
  if (!s) return ''
  const d = String(s).replace(/[^\d]/g, '')
  if (d.length === 10) return `${d.slice(0,2)}-${d.slice(2,6)}-${d.slice(6)}`
  if (d.length === 11) return `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`
  if (d.length === 9)  return `${d.slice(0,2)}-${d.slice(2,5)}-${d.slice(5)}`
  return s
}

function formatSize(b) {
  if (!b || isNaN(b)) return '-'
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(2)} MB`
}

function DetailPanel({ item }) {
  const [zipping, setZipping] = useState(false)
  const [zipError, setZipError] = useState(null)
  const [summary, setSummary] = useState('')

  const downloadZip = async () => {
    if (!item.files || item.files.length === 0) return
    setZipping(true)
    setZipError(null)
    setSummary('')
    try {
      const res = await fetch('/api/download-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bidNo: item.bidNo,
          name: item.name,
          untyAtchFileNo: item.untyAtchFileNo,
          files: item.files,
        }),
      })
      if (!res.ok) {
        const t = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status} ${t.slice(0, 200)}`)
      }
      // 응답 헤더에서 요약 추출 (base64-UTF8)
      const summaryB64 = res.headers.get('X-Summary-B64') || ''
      if (summaryB64) {
        try {
          const bytes = Uint8Array.from(atob(summaryB64), c => c.charCodeAt(0))
          setSummary(new TextDecoder('utf-8').decode(bytes))
        } catch {}
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const safeName = (item.name || 'files').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
      a.download = `${item.bidNo || 'g2b'}_${safeName}.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setZipError(e.message || String(e))
    } finally {
      setZipping(false)
    }
  }

  return (
    <div className="detail-panel">
      <div className="detail-meta">
        <div><b>낙찰방법</b> {item.scsbdMthd || '-'}</div>
        <div><b>예가방법</b> {item.pnprMtho || '-'}</div>
        <div><b>공고종류</b> {item.pbancKnd || '-'}</div>
        <div><b>VAT</b> {item.vatAmt || '-'}</div>
      </div>

      {item.aiReason && (
        <div className="ai-judge">
          <b>🤖 AI 분류 근거:</b> {item.aiReason}
        </div>
      )}

      {item.prevHistory && item.prevHistory.length > 0 && (
        <div className="prev-history">
          <b>📜 이전 채용대행 기록</b>
          {item.prevMatched && item.prevMatched !== (item.demander || item.agency) && (
            <span className="prev-matched">  (매칭: {item.prevMatched})</span>
          )}
          <div className="prev-list">
            {item.prevHistory.map((p, i) => (
              <span key={i} className="prev-item">
                <b>{p.year}</b> · {p.agencies.join(', ')}
              </span>
            ))}
          </div>
        </div>
      )}

      <h4>입찰진행정보</h4>
      {(!item.progress || item.progress.length === 0) ? (
        <div className="empty">진행정보 없음</div>
      ) : (
        <table className="progress-table">
          <thead>
            <tr>
              <th className="w-no">No</th>
              <th>진행명</th>
              <th>진행방법</th>
              <th>시작일시</th>
              <th>종료일시</th>
              <th>장소</th>
            </tr>
          </thead>
          <tbody>
            {item.progress.map((p, j) => (
              <tr key={j}>
                <td className="w-no">{j + 1}</td>
                <td>{p.subject}</td>
                <td>{p.prgNm}</td>
                <td className="mono">{p.startDt}</td>
                <td className="mono">{p.endDt}</td>
                <td>{p.placNm}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h4>수요기관 담당자</h4>
      {(!item.dmstPic || item.dmstPic.length === 0) ? (
        <div className="empty">담당자 정보 없음</div>
      ) : (
        <table className="progress-table">
          <thead>
            <tr>
              <th className="w-no">No</th>
              <th>수요기관</th>
              <th>부서명</th>
              <th>담당자</th>
              <th>전화번호</th>
              <th>팩스번호</th>
              <th>이메일</th>
              <th>평가</th>
            </tr>
          </thead>
          <tbody>
            {item.dmstPic.map((p, j) => (
              <tr key={j}>
                <td className="w-no">{j + 1}</td>
                <td>{p.dmstUntyGrpNm}</td>
                <td>{p.deptNm}</td>
                <td>{p.picNm}</td>
                <td className="mono">{formatPhone(p.tlphNo)}</td>
                <td className="mono">{formatPhone(p.faxNo)}</td>
                <td>{p.eml || '-'}</td>
                <td className="w-no">{p.evlPicYn === 'Y' ? 'O' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h4>
        파일첨부{' '}
        {item.files && item.files.length > 0 && (
          <button
            className="zip-btn"
            onClick={downloadZip}
            disabled={zipping}
            style={{ marginLeft: 8 }}
            title="g2b 헤드리스 브라우저로 자동 진입해서 ZIP으로 받습니다 (1~2분 소요)"
          >
            {zipping ? '⏳ 자동 다운로드 중… (1~2분 소요)' : '📦 일괄 다운로드 (ZIP)'}
          </button>
        )}
      </h4>
      {zipError && (
        <div className="error" style={{ margin: '4px 0' }}>
          <b>다운로드 실패:</b> {zipError}
        </div>
      )}
      {summary && (
        <div className="summary-box">
          <div className="summary-head">🧠 GPT 요약</div>
          <pre>{summary}</pre>
        </div>
      )}
      {(!item.files || item.files.length === 0) ? (
        <div className="empty">첨부파일 없음</div>
      ) : (
        <table className="progress-table">
          <thead>
            <tr>
              <th className="w-no">No</th>
              <th>문서구분</th>
              <th>파일명</th>
              <th>파일크기</th>
              <th>등록자</th>
              <th>등록일시</th>
            </tr>
          </thead>
          <tbody>
            {item.files.map((f, j) => (
              <tr key={j}>
                <td className="w-no">{j + 1}</td>
                <td>{f.atchFileKndNm || f.atchFileKndCd || '-'}</td>
                <td>{f.orgnlAtchFileNm}</td>
                <td className="mono">{formatSize(f.fileSz)}</td>
                <td>{f.kbrdrNm}</td>
                <td className="mono">{f.inptDt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
