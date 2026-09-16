import { useEffect, useState } from 'react'
import { authFetch } from '../auth.js'

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = Array.from({ length: 60 }, (_, i) => i)

function fmtNext(iso) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
}

export default function OverseasCronSettings() {
  const [s, setS] = useState(null)
  const [edit, setEdit] = useState(null)
  const [runs, setRuns] = useState([])
  const [sources, setSources] = useState([])
  const [err, setErr] = useState(null)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setErr(null)
    try {
      const r = await authFetch('/api/admin/overseas/cron-settings')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setS(j)
      setEdit({ hour: j.hour, minute: j.minute, enabled: !!j.enabled,
                hour2: j.hour2 ?? 15, minute2: j.minute2 ?? 0, enabled2: !!(j.enabled2 ?? 1), days_back: j.days_back })
    } catch (e) { setErr(e.message) }
    try {
      const r = await authFetch('/api/admin/overseas/cron-runs?limit=10')
      if (r.ok) {
        const j = await r.json()
        setRuns(j.items || [])
      }
    } catch { /* 로그는 부가 정보 — 실패해도 무시 */ }
    try {
      const r = await authFetch('/api/admin/overseas/sources')
      if (r.ok) {
        const j = await r.json()
        setSources(j.items || [])
      }
    } catch { /* 소스 목록 실패해도 스케줄 표시는 유지 */ }
  }
  useEffect(() => { load() }, [])

  const toggleSource = async (src) => {
    try {
      const r = await authFetch(`/api/admin/overseas/sources/${src.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: src.enabled ? 0 : 1 }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setSources(prev => prev.map(x => x.id === src.id ? { ...x, enabled: src.enabled ? 0 : 1 } : x))
    } catch (e) { setErr(e.message) }
  }

  const save = async () => {
    if (!edit) return
    setBusy(true); setErr(null); setMsg(null)
    try {
      const r = await authFetch('/api/admin/overseas/cron-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(edit),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setS(j.settings)
      setMsg('저장 완료')
      setTimeout(() => setMsg(null), 2000)
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  const runNow = async () => {
    if (!confirm('지금 바로 해외 공고 크롤링을 실행하시겠습니까? (백그라운드)')) return
    setBusy(true); setErr(null); setMsg(null)
    try {
      const r = await authFetch('/api/admin/overseas/cron-settings/run-now', { method: 'POST' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setMsg('실행 시작 — 잠시 후 아래 실행 로그를 새로고침하세요')
      setTimeout(() => setMsg(null), 3000)
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  if (!s || !edit) return <div className="empty">불러오는 중</div>

  const dirty = edit.hour !== s.hour || edit.minute !== s.minute
    || !!edit.enabled !== !!s.enabled || Number(edit.days_back) !== Number(s.days_back)
    || edit.hour2 !== (s.hour2 ?? 15) || edit.minute2 !== (s.minute2 ?? 0) || !!edit.enabled2 !== !!(s.enabled2 ?? 1)

  return (
    <div>
      <div className="page-head">
        <h2>해외 공고 크롤링 스케줄</h2>
        <div className="page-sub">매일 2회 (오전·오후) 자동 실행 시각 (KST) — 채용공고 크롤링 스케줄과 별개</div>
      </div>

      {err && <div className="error">{err}</div>}
      {msg && <div className="info">{msg}</div>}

      <div className="run-box" style={{ maxWidth: 560 }}>
        <div className="kv">
          <span>활성</span>
          <b>
            <label style={{ display:'inline-flex', alignItems:'center', gap:8 }}>
              <input
                type="checkbox"
                checked={!!edit.enabled}
                onChange={e => setEdit({ ...edit, enabled: e.target.checked })}
              />
              {edit.enabled ? '예' : '아니오'}
            </label>
          </b>
        </div>
        <div className="kv">
          <span>오전 실행</span>
          <b>
            <select
              value={edit.hour}
              onChange={e => setEdit({ ...edit, hour: Number(e.target.value) })}
            >
              {HOURS.map(h => <option key={h} value={h}>{String(h).padStart(2,'0')}시</option>)}
            </select>
            {' '}
            <select
              value={edit.minute}
              onChange={e => setEdit({ ...edit, minute: Number(e.target.value) })}
            >
              {MINUTES.map(m => <option key={m} value={m}>{String(m).padStart(2,'0')}분</option>)}
            </select>
          </b>
        </div>
        <div className="kv">
          <span>오후 실행</span>
          <b>
            <label style={{ display:'inline-flex', alignItems:'center', gap:6, marginRight:8 }}>
              <input
                type="checkbox"
                checked={!!edit.enabled2}
                onChange={e => setEdit({ ...edit, enabled2: e.target.checked })}
              />
              {edit.enabled2 ? '켬' : '끔'}
            </label>
            <select
              value={edit.hour2}
              disabled={!edit.enabled2}
              onChange={e => setEdit({ ...edit, hour2: Number(e.target.value) })}
            >
              {HOURS.map(h => <option key={h} value={h}>{String(h).padStart(2,'0')}시</option>)}
            </select>
            {' '}
            <select
              value={edit.minute2}
              disabled={!edit.enabled2}
              onChange={e => setEdit({ ...edit, minute2: Number(e.target.value) })}
            >
              {MINUTES.map(m => <option key={m} value={m}>{String(m).padStart(2,'0')}분</option>)}
            </select>
          </b>
        </div>
        <div className="kv">
          <span>나라장터 검색 윈도우</span>
          <b>
            최근{' '}
            <input
              type="number" min={1} max={90}
              value={edit.days_back}
              onChange={e => setEdit({ ...edit, days_back: Number(e.target.value) })}
              style={{ width: 70 }}
            />
            {' '}일
          </b>
        </div>
        <div className="kv"><span>다음 실행 (예상)</span><b>{fmtNext(s.next_run_at)}</b></div>
        <div className="kv"><span>최근 변경</span><b>{s.updated_at ? new Date(s.updated_at).toLocaleString('ko-KR') : '-'}</b></div>
      </div>

      <div className="quick-links">
        <button onClick={save} disabled={busy || !dirty} className="btn-link">저장</button>
        <button onClick={runNow} disabled={busy} className="btn-link secondary">지금 실행</button>
        <button onClick={load} disabled={busy} className="btn-link secondary">새로고침</button>
      </div>

      <h3 style={{ marginTop: 32 }}>기관별 크롤링 on/off</h3>
      {sources.length === 0 ? (
        <div className="empty">등록된 크롤링 소스가 없습니다. (migrate_overseas.mjs 실행 필요)</div>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>기관명</th>
              <th style={{width:80,textAlign:'center'}}>크롤링</th>
              <th style={{width:150}}>마지막 크롤</th>
              <th style={{width:70,textAlign:'center'}}>상태</th>
              <th>수집 방식</th>
              <th style={{width:120}}></th>
            </tr>
          </thead>
          <tbody>
            {sources.map(src => (
              <tr key={src.id} className={src.enabled ? '' : 'inactive'}>
                <td>
                  {src.site_url && src.site_url !== '-'
                    ? <a href={src.site_url} target="_blank" rel="noreferrer">{src.name}</a>
                    : src.name}
                </td>
                <td className="center">
                  {src.enabled
                    ? <span className="badge agent">ON</span>
                    : <span className="badge other">OFF</span>}
                </td>
                <td className="small muted">
                  {src.last_crawled_at ? new Date(src.last_crawled_at).toLocaleString('ko-KR') : '-'}
                </td>
                <td className="center">
                  {src.last_status === 'ok' ? '○'
                    : src.last_status === 'error' ? <span title={src.last_error || ''}>⚠</span>
                    : '−'}
                </td>
                <td className="small muted" style={{whiteSpace:'pre-line'}}>{src.method_note || '-'}</td>
                <td>
                  <button onClick={() => toggleSource(src)} className={src.enabled ? 'sm-btn danger' : 'sm-btn primary'}>
                    {src.enabled ? '끄기' : '켜기'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 style={{ marginTop: 32 }}>최근 실행 로그</h3>
      {runs.length === 0 ? (
        <div className="empty">실행 기록이 없습니다.</div>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th style={{width:40}}>#</th>
              <th style={{width:150}}>시작</th>
              <th style={{width:150}}>종료</th>
              <th style={{width:80,textAlign:'center'}}>상태</th>
              <th style={{width:60,textAlign:'center'}}>수집</th>
              <th style={{width:60,textAlign:'center'}}>신규</th>
              <th style={{width:60,textAlign:'center'}}>메일</th>
              <th>오류</th>
            </tr>
          </thead>
          <tbody>
            {runs.map(r => (
              <tr key={r.id}>
                <td className="mono">{r.id}</td>
                <td className="small">{r.started_at ? new Date(r.started_at).toLocaleString('ko-KR') : '-'}</td>
                <td className="small">{r.finished_at ? new Date(r.finished_at).toLocaleString('ko-KR') : '-'}</td>
                <td className="center">
                  {r.status === 'success' ? <span className="badge agent">성공</span>
                    : r.status === 'failed' ? <span className="badge other">실패</span>
                    : <span className="badge unknown">실행중</span>}
                </td>
                <td className="center">{r.total_found ?? '-'}</td>
                <td className="center">{r.new_count ?? '-'}</td>
                <td className="center">{r.email_sent ? '○' : '−'}</td>
                <td className="small muted">{r.error_msg || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="small muted" style={{ marginTop: 24 }}>
        * 각 소스에서 이전에 못 본 공고만 신규로 저장한 뒤, 제목에 태국이 명시되면 A(확정), 동남아·아세안 권역이면 GPT 가 B 로 판별하고
        A·B 만 메일로 보냅니다(마감 D-day·금액·주제 포함). 검색 윈도우는 나라장터(g2b) 검색에만 쓰이고, 나머지 소스는 게시판 첫 페이지를 봅니다.
      </p>
    </div>
  )
}
