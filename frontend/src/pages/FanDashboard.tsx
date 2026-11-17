import { Link } from 'react-router'
import { PageHeading } from '../components/WorkspaceUI'
import { useAuth } from '../contexts/AuthContext'
import { formatDate } from '../services/format'

export function FanDashboard() {
  const { user } = useAuth()
  return <main className="wb-page">
    <div className="wb-hero"><div><span className="wb-kicker">FAN DASHBOARD</span><h1>Hello, {user?.name.split(' ')[0]}.</h1><p>There is room for your passion beyond the court.</p></div><span className="wb-hero-mark" aria-hidden="true">BC</span></div>
    <PageHeading kicker="YOUR SPACE" title="Welcome to the team" description="Follow the fixtures and results of the teams you love." />
    <div className="wb-grid">
      <section className="wb-card"><div className="wb-card-heading"><h2>Your account</h2><Link className="wb-button wb-button-link" to="/fan/account">View details ↗</Link></div><ul className="wb-list"><li className="wb-list-row"><div className="wb-list-main"><strong>Name</strong></div><span className="wb-list-end">{user?.name}</span></li><li className="wb-list-row"><div className="wb-list-main"><strong>Email</strong></div><span className="wb-list-end">{user?.email}</span></li><li className="wb-list-row"><div className="wb-list-main"><strong>Member since</strong></div><span className="wb-list-end">{user?.created_at ? formatDate(user.created_at) : '—'}</span></li></ul></section>
      <section className="wb-card"><div className="wb-card-heading"><h2>Game day</h2></div><p className="wb-muted">Explore team calendars, upcoming fixtures and final scores.</p><Link className="wb-button wb-button-primary" to="/matches">Open the calendar</Link></section>
    </div>
  </main>
}
