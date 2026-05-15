import { useEffect, useState } from 'react'
import { authFetch } from '../auth.js'

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = Array.from({ length: 60 }, (_, i) => i)

function fmtNext(iso) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
}

export default function AdminCronSettings() {
  const [s, setS] = useState(null)
  const [edit, setEdit] = useState(null)
  const [err, setErr] = useState(null)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setErr(null)
    try {
      const r = await authFetch('/api/admin/cron-settings')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setS(j)
      setEdit({ hour: j.hour, minute: j.minute, enabled: !!j.enabled, days_back: j.days_back })
    } catch (e) { setErr(e.message) }
  }
  useEffect(() => { load() }, [])

  const save = async () => {
    if (!edit) return
    setBusy(true); setErr(null); setMsg(null)
    try {
      const r = await authFetch('/api/admin/cron-settings', {
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
    if (!confirm('지금 바로 cron 을 실행하시겠습니까? (백그라운드)')) return
    setBusy(true); setErr(null); setMsg(null)
    try {
      const r = await authFetch('/api/admin/cron-settings/run-now', { method: 'POST' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setMsg('실행 시작 — 진행 상황은 대시보드에서 확인')
      setTimeout(() => setMsg(null), 3000)
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  if (!s || !edit) return <div className="empty">불러오는 중</div>

  const dirty = edit.hour !== s.hour || edit.minute !== s.minute
    || !!edit.enabled !== !!s.enabled || Number(edit.days_back) !== Number(s.days_back)

  return (
    <div>
      <div className="page-head">
        <h2>크롤링 스케줄</h2>
        <div className="page-sub">매일 1회 자동 실행 시각 (KST)</div>
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
          <span>실행 시각</span>
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
          <span>검색 윈도우</span>
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
      </div>

      <p className="small muted" style={{ marginTop: 24 }}>
        * 스케줄러는 API 서버(g2b-api) 안에서 동작합니다. 운영 환경에서는 systemd timer
        <code> g2b-daily.timer </code>를 비활성화 (<code>sudo systemctl disable --now g2b-daily.timer</code>) 한 뒤 사용하세요.
      </p>
    </div>
  )
}
