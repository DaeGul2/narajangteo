// 단순 LOGIN_KEY 인증 — localStorage 토큰 + httpOnly 쿠키 둘 다 사용
// 쿠키는 서버가 set-cookie 로 발급. 새로고침해도 유지됨.

const KEY = 'g2b_admin_token'

export function getToken() {
  try { return localStorage.getItem(KEY) || '' } catch { return '' }
}

export function setToken(t) {
  try {
    if (t) localStorage.setItem(KEY, t)
    else localStorage.removeItem(KEY)
  } catch {}
}

export async function login(key) {
  const r = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  })
  const j = await r.json().catch(() => ({}))
  if (r.ok && j.ok) {
    setToken(j.token || key)
    return { ok: true }
  }
  return { ok: false, error: j.error || `HTTP ${r.status}` }
}

export async function check() {
  const r = await fetch('/api/auth/check', { credentials: 'include' })
  const j = await r.json().catch(() => ({}))
  return !!j.ok
}

export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
  setToken('')
}

// 인증 헤더 포함 fetch (쿠키와 Bearer 둘 다)
export async function authFetch(url, opts = {}) {
  const headers = { ...(opts.headers || {}) }
  const t = getToken()
  if (t) headers['Authorization'] = `Bearer ${t}`
  return fetch(url, { ...opts, headers, credentials: 'include' })
}
