// 단순 LOGIN_KEY 기반 인증. 토큰 = LOGIN_KEY 자체 (Bearer)
// admin 페이지 라우트 보호용 미들웨어

export function requireAuth(req, res, next) {
  const expected = process.env.LOGIN_KEY;
  if (!expected) return res.status(500).json({ error: 'LOGIN_KEY 미설정' });
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  // 헤더에 없으면 쿠키에서
  const cookieToken = (req.headers.cookie || '')
    .split(';')
    .map(c => c.trim())
    .find(c => c.startsWith('g2b_session='))
    ?.slice('g2b_session='.length);
  if (token === expected || cookieToken === expected) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

export function loginRoute(req, res) {
  const expected = process.env.LOGIN_KEY;
  if (!expected) return res.status(500).json({ error: 'LOGIN_KEY 미설정' });
  const key = (req.body && req.body.key) || '';
  if (key !== expected) {
    return res.status(401).json({ ok: false, error: '키가 일치하지 않습니다' });
  }
  // 세션 쿠키 — 만료 90일
  res.setHeader('Set-Cookie',
    `g2b_session=${expected}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 90}`
  );
  res.json({ ok: true, token: expected });
}

export function checkRoute(req, res) {
  const expected = process.env.LOGIN_KEY;
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const cookieToken = (req.headers.cookie || '')
    .split(';').map(c => c.trim())
    .find(c => c.startsWith('g2b_session='))?.slice('g2b_session='.length);
  const ok = (token === expected) || (cookieToken === expected);
  res.json({ ok });
}

export function logoutRoute(_req, res) {
  res.setHeader('Set-Cookie', 'g2b_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
}
