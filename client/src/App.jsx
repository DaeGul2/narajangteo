import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom'
import { check, login, logout, getToken } from './auth.js'
import Crawl from './pages/Crawl.jsx'
import Login from './pages/Login.jsx'
import AdminDashboard from './pages/AdminDashboard.jsx'
import AdminNotices from './pages/AdminNotices.jsx'
import AdminNoticeDetail from './pages/AdminNoticeDetail.jsx'
import AdminRecipients from './pages/AdminRecipients.jsx'

// ─ 좌측 drawer 메뉴 (그룹 단위로 향후 확장)
const MENU_GROUPS = [
  {
    title: '채용공고 크롤링',
    items: [
      { to: '/admin', label: '대시보드', end: true },
      { to: '/admin/notices', label: '공고 목록' },
      { to: '/admin/recipients', label: '수신자 관리' },
      { to: '/crawl', label: '수동 크롤링' },
    ],
  },
  // 추후 v2~ 신규 그룹은 여기에:
  // { title: '한글문서 자동작성', items: [{ to: '/admin/templates', label: '양식 관리' }] },
]

function Protected({ children }) {
  const [state, setState] = useState('loading')
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
    <div className="layout-root">
      {/* 상단 헤더 */}
      <header className="app-header">
        <div className="app-brand">경영지원헬퍼</div>
        <div className="header-spacer" />
        <button className="logout-btn" onClick={onLogout}>로그아웃</button>
      </header>

      <div className="layout-body">
        {/* 좌측 drawer */}
        <aside className="drawer">
          {MENU_GROUPS.map(g => (
            <div key={g.title} className="drawer-group">
              <div className="drawer-group-title">{g.title}</div>
              <nav className="drawer-nav">
                {g.items.map(it => (
                  <NavLink key={it.to} to={it.to} end={it.end}>
                    {it.label}
                  </NavLink>
                ))}
              </nav>
            </div>
          ))}
        </aside>

        {/* 메인 컨텐츠 */}
        <main className="app-main">
          <div className="app">{children}</div>
        </main>
      </div>
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
