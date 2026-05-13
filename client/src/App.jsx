import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom'
import { check, login, logout, getToken } from './auth.js'
import Crawl from './pages/Crawl.jsx'
import Login from './pages/Login.jsx'
import AdminDashboard from './pages/AdminDashboard.jsx'
import AdminNotices from './pages/AdminNotices.jsx'
import AdminNoticeDetail from './pages/AdminNoticeDetail.jsx'
import AdminRecipients from './pages/AdminRecipients.jsx'

function Protected({ children }) {
  const [state, setState] = useState('loading')  // loading | ok | denied
  useEffect(() => {
    (async () => {
      if (!getToken()) { setState('denied'); return }
      const ok = await check()
      setState(ok ? 'ok' : 'denied')
    })()
  }, [])
  if (state === 'loading') return <div style={{ padding: 40 }}>로딩 중…</div>
  if (state === 'denied') return <Navigate to="/login" replace />
  return children
}

function Layout({ children }) {
  const nav = useNavigate()
  const onLogout = async () => {
    await logout()
    nav('/login')
  }
  return (
    <div>
      <nav className="top-nav">
        <span className="brand">G2B Crawler</span>
        <NavLink to="/admin" end>대시보드</NavLink>
        <NavLink to="/admin/notices">공고 목록</NavLink>
        <NavLink to="/admin/recipients">수신자</NavLink>
        <NavLink to="/crawl">수동 크롤링</NavLink>
        <span style={{ flex: 1 }} />
        <button className="logout-btn" onClick={onLogout}>로그아웃</button>
      </nav>
      <div className="app">{children}</div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Navigate to="/admin" replace />} />
        <Route path="/admin" element={<Protected><Layout><AdminDashboard /></Layout></Protected>} />
        <Route path="/admin/notices" element={<Protected><Layout><AdminNotices /></Layout></Protected>} />
        <Route path="/admin/notices/:bidNo" element={<Protected><Layout><AdminNoticeDetail /></Layout></Protected>} />
        <Route path="/admin/recipients" element={<Protected><Layout><AdminRecipients /></Layout></Protected>} />
        <Route path="/crawl" element={<Protected><Layout><Crawl /></Layout></Protected>} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export { login }
