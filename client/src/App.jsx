import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom'
import { check, login, logout, getToken } from './auth.js'
import Crawl from './pages/Crawl.jsx'
import Login from './pages/Login.jsx'
import AdminDashboard from './pages/AdminDashboard.jsx'
import AdminNotices from './pages/AdminNotices.jsx'
import AdminNoticeDetail from './pages/AdminNoticeDetail.jsx'
import AdminRecipients from './pages/AdminRecipients.jsx'
import AdminCronSettings from './pages/AdminCronSettings.jsx'
import BidEmployee from './pages/BidEmployee.jsx'
import BidEmployeeDetail from './pages/BidEmployeeDetail.jsx'
import BidProject from './pages/BidProject.jsx'
import BidLab from './pages/BidLab.jsx'
import AttendanceLab from './pages/AttendanceLab.jsx'
import AttendanceReport from './pages/AttendanceReport.jsx'
import AttendanceHolidays from './pages/AttendanceHolidays.jsx'

// ─ 좌측 drawer 메뉴 (그룹 단위로 향후 확장)
const MENU_GROUPS = [
  {
    title: '채용공고 크롤링',
    items: [
      { to: '/admin', label: '대시보드', end: true },
      { to: '/admin/notices', label: '공고 목록' },
      { to: '/admin/recipients', label: '수신자 관리' },
      { to: '/admin/cron', label: '스케줄 설정' },
      { to: '/crawl', label: '수동 크롤링' },
    ],
  },
  {
    title: '입찰',
    items: [
      { to: '/bid/employee', label: '직원' },
      { to: '/bid/projects', label: '유사사업' },
      { to: '/bid/lab', label: '실험실' },
    ],
  },
  {
    title: '출퇴근 관리',
    items: [
      { to: '/attendance/report', label: '리포트' },
      { to: '/attendance/holidays', label: '공휴일 캘린더' },
      { to: '/attendance/lab', label: '실험실' },
    ],
  },
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
  // 그룹 펼침/접힘 (기본: 모두 펼침)
  const [openGroups, setOpenGroups] = useState(() =>
    Object.fromEntries(MENU_GROUPS.map(g => [g.title, true]))
  )
  const toggle = (t) => setOpenGroups(p => ({ ...p, [t]: !p[t] }))

  return (
    <div className="layout-root">
      <header className="app-header">
        <div className="app-brand">경영지원헬퍼</div>
        <div className="header-spacer" />
        <button className="logout-btn" onClick={onLogout}>로그아웃</button>
      </header>

      <div className="layout-body">
        <aside className="drawer">
          {MENU_GROUPS.map(g => {
            const open = !!openGroups[g.title]
            return (
              <div key={g.title} className="drawer-group">
                <button
                  className={`drawer-group-title ${open ? 'open' : ''}`}
                  onClick={() => toggle(g.title)}
                  type="button"
                >
                  <span>{g.title}</span>
                  <span className="caret">{open ? '▾' : '▸'}</span>
                </button>
                {open && (
                  <nav className="drawer-nav">
                    {g.items.map(it => (
                      <NavLink key={it.to} to={it.to} end={it.end}>
                        {it.label}
                      </NavLink>
                    ))}
                  </nav>
                )}
              </div>
            )
          })}
        </aside>

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
        <Route path="/admin/cron" element={<Protected><Layout><AdminCronSettings /></Layout></Protected>} />
        <Route path="/crawl" element={<Protected><Layout><Crawl /></Layout></Protected>} />
        <Route path="/bid/employee" element={<Protected><Layout><BidEmployee /></Layout></Protected>} />
        <Route path="/bid/employee/:id" element={<Protected><Layout><BidEmployeeDetail /></Layout></Protected>} />
        <Route path="/bid/projects" element={<Protected><Layout><BidProject /></Layout></Protected>} />
        <Route path="/bid/lab" element={<Protected><Layout><BidLab /></Layout></Protected>} />
        <Route path="/attendance/lab" element={<Protected><Layout><AttendanceLab /></Layout></Protected>} />
        <Route path="/attendance/report" element={<Protected><Layout><AttendanceReport /></Layout></Protected>} />
        <Route path="/attendance/holidays" element={<Protected><Layout><AttendanceHolidays /></Layout></Protected>} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export { login }
