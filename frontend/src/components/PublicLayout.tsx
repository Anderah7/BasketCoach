import { Link, Outlet, useLocation } from 'react-router'
import { Brand } from './Brand'

export function PublicLayout() {
  const { pathname } = useLocation()

  return (
    <div className="public-shell">
      <div className="scene-backdrop" aria-hidden="true" />
      <header className="site-header">
        <Brand />
        <nav className="site-nav" aria-label="Main navigation">
          <Link className={pathname === '/' ? 'active' : ''} to="/">Home</Link>
          <a href="/#platform">The platform</a>
          <Link className="nav-secondary" to="/register">Create account</Link>
          <Link className="nav-login" to="/login">Log in <span aria-hidden="true">↗</span></Link>
        </nav>
      </header>
      <Outlet />
      <footer className="site-footer">
        <span>© {new Date().getFullYear()} BasketCoach</span>
        <span>Made for everyone who lives basketball.</span>
      </footer>
    </div>
  )
}
