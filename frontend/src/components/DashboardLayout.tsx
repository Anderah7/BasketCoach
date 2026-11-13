import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../contexts/AuthContext'
import { dashboardPath } from '../types/auth'
import type { UserRole } from '../types/auth'
import { Brand } from './Brand'
import './dashboard.css'

type IconName = 'grid' | 'team' | 'ball' | 'calendar' | 'spark' | 'profile' | 'logout'

const navigation: Record<UserRole, { to: string; label: string; icon: IconName }[]> = {
  coach: [
    { to: '/coach/dashboard', label: 'Overview', icon: 'grid' },
    { to: '/coach/teams', label: 'My teams', icon: 'team' },
    { to: '/coach/exercises', label: 'Exercises', icon: 'ball' },
    { to: '/coach/trainings', label: 'Training', icon: 'calendar' },
    { to: '/coach/ai', label: 'AI assistant', icon: 'spark' },
  ],
  player: [
    { to: '/player/dashboard', label: 'Overview', icon: 'grid' },
    { to: '/player/team', label: 'My team', icon: 'team' },
    { to: '/player/trainings', label: 'Training', icon: 'calendar' },
    { to: '/player/profile', label: 'Player profile', icon: 'profile' },
  ],
  fan: [
    { to: '/fan/dashboard', label: 'Overview', icon: 'grid' },
    { to: '/fan/account', label: 'My account', icon: 'profile' },
  ],
}

const roleLabel: Record<UserRole, string> = {
  coach: 'Coach', player: 'Player', fan: 'Fan',
}

const accountPath: Record<UserRole, string> = {
  coach: '/coach/account', player: '/player/profile', fan: '/fan/account',
}

function NavIcon({ name }: { name: IconName }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  const paths: Record<IconName, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    team: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 6a3 3 0 0 1 0 6M17 15a5 5 0 0 1 4 5" /></>,
    ball: <><circle cx="12" cy="12" r="9" /><path d="M12 3v18M3 12h18M5.5 5.5c5 2 8 8 8 15M18.5 5.5c-5 2-8 8-8 15" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18M8 15h3M15 15h1" /></>,
    spark: <><path d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2ZM19 17l.6 1.4L21 19l-1.4.6L19 21l-.6-1.4L17 19l1.4-.6L19 17Z" /></>,
    profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
    logout: <><path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5M14 16l4-4-4-4M9 12h9" /></>,
  }
  return <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" {...common}>{paths[name]}</svg>
}

export function DashboardLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [accountOpen, setAccountOpen] = useState(false)
  const accountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!accountOpen) return
    function closeOnOutsideClick(event: PointerEvent) {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false)
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setAccountOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [accountOpen])

  if (!user) return null

  const links = navigation[user.role]
  const current = links.find((link) => link.to === location.pathname)?.label
    ?? (location.pathname === accountPath[user.role] ? 'My account' : 'Your space')
  const today = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())

  function handleLogout() {
    setAccountOpen(false)
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="workbench">
      <div className="workbench-frame">
        <aside className="workbench-sidebar">
          <div className="sidebar-brand"><Brand to={dashboardPath[user.role]} /></div>
          <div className="sidebar-caption">YOUR SPACE</div>
          <nav className="sidebar-nav" aria-label="Dashboard navigation">
            {links.map((link) => (
              <NavLink key={link.to} to={link.to} end className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
                <NavIcon name={link.icon} /><span>{link.label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-profile">
              <span className="sidebar-avatar">{user.name.charAt(0).toUpperCase()}</span>
              <span><strong>{user.name}</strong><small>{roleLabel[user.role]}</small></span>
            </div>
            <button className="sidebar-logout" onClick={handleLogout}><NavIcon name="logout" /> Log out</button>
          </div>
        </aside>

        <div className="workbench-panel">
          <header className="workbench-topbar">
            <div><span className="topbar-kicker">BASKETCOACH / {roleLabel[user.role].toUpperCase()}</span><strong>{current}</strong></div>
            <div className="topbar-right"><span className="topbar-date">{today}</span><div className="topbar-account" ref={accountRef}>
              <button type="button" className="topbar-account-trigger" onClick={() => setAccountOpen((open) => !open)} aria-expanded={accountOpen} aria-controls="account-popover" aria-label={`Open account menu for ${user.name}`}>
                <span className="topbar-user">{user.name.charAt(0).toUpperCase()}</span><span className="topbar-account-chevron" aria-hidden="true">⌄</span>
              </button>
              {accountOpen && <div className="account-popover" id="account-popover">
                <div className="account-popover-header"><strong>{user.name}</strong><span>{user.email}</span><small>{roleLabel[user.role]}</small></div>
                <Link to={accountPath[user.role]} className="account-popover-item" onClick={() => setAccountOpen(false)}><NavIcon name="profile" />{user.role === 'player' ? 'Player profile' : 'My account'}</Link>
                <Link to={dashboardPath[user.role]} className="account-popover-item" onClick={() => setAccountOpen(false)}><NavIcon name="grid" />Go to dashboard</Link>
                <button type="button" className="account-popover-item account-popover-logout" onClick={handleLogout}><NavIcon name="logout" />Log out</button>
              </div>}
            </div></div>
          </header>
          <Outlet />
        </div>
      </div>
    </div>
  )
}
