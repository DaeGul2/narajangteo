import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { login } from '../auth.js'

export default function Login() {
  const [key, setKey] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()

  const onSubmit = async (e) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    const r = await login(key)
    setBusy(false)
    if (r.ok) nav('/admin')
    else setErr(r.error || '로그인 실패')
  }
  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        <h1>G2B Crawler</h1>
        <p className="sub">관리자 로그인</p>
        <label className="lbl">접속 키</label>
        <input
          type="password"
          autoFocus
          placeholder="입력"
          value={key}
          onChange={e => setKey(e.target.value)}
        />
        {err && <div className="login-err">{err}</div>}
        <button type="submit" disabled={busy || !key}>
          {busy ? '확인 중' : '로그인'}
        </button>
      </form>
    </div>
  )
}
