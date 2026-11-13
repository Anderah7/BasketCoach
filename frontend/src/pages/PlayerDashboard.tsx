import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { EmptyState, MetricCard, Notice, PageHeading, StatusPill } from '../components/WorkspaceUI'
import { useAuth } from '../contexts/AuthContext'
import { errorText, formatDateTime, positionLabel } from '../services/format'
import type { PlayerProfile, PlayerTraining } from '../types/sports'

export function PlayerDashboard() {
  const { user, request } = useAuth()
  const [profile, setProfile] = useState<PlayerProfile | null>(null)
  const [trainings, setTrainings] = useState<PlayerTraining[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      request<PlayerProfile>('/players/me', { signal: controller.signal }),
      request<PlayerTraining[]>('/players/me/trainings', { signal: controller.signal }),
    ]).then(([loadedProfile, loadedTrainings]) => {
      setProfile(loadedProfile); setTrainings(loadedTrainings); setLoading(false)
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) { setError(errorText(cause)); setLoading(false) }
    })
    return () => controller.abort()
  }, [request])

  const teamName = trainings.find((item) => item.team_id === profile?.team_id)?.team_name
  const active = trainings.filter((item) => item.status === 'PENDING' || item.status === 'IN_PROGRESS')

  return <main className="wb-page">
    <div className="wb-hero"><div><span className="wb-kicker">PLAYER DASHBOARD</span><h1>Hello, {user?.name.split(' ')[0]}.</h1><p>Every training session takes your game one step further.</p></div><span className="wb-hero-mark" aria-hidden="true">BC</span></div>
    <PageHeading kicker="YOUR PROGRESS" title="Keep moving forward" description="Your profile and assignments, updated from BasketCoach." actions={<Link className="wb-button wb-button-primary" to="/player/trainings">View training ↗</Link>} />
    {error && <Notice kind="error">{error}</Notice>}
    {loading ? <Notice>Loading your dashboard...</Notice> : <>
      <div className="wb-metrics">
        <MetricCard label="My team" value={profile?.team_id ? (teamName ?? `#${profile.team_id}`) : 'No team'} note="Current membership" />
        <MetricCard label="Assignments" value={trainings.length} note="Includes history" />
        <MetricCard label="Pending or in progress" value={active.length} note="Sessions to complete" />
        <MetricCard label="Completed" value={trainings.filter((item) => item.status === 'COMPLETED').length} note="Finished sessions" />
      </div>
      <div className="wb-grid">
        <section className="wb-card"><div className="wb-card-heading"><h2>Your upcoming sessions</h2><Link className="wb-button wb-button-link" to="/player/trainings">View all ↗</Link></div>
          {active.length ? <ul className="wb-list">{active.slice(0, 5).map((training) => <li className="wb-list-row" key={training.assignment_id}><div className="wb-list-main"><strong>{training.title}</strong><span>{training.team_name} · {formatDateTime(training.date)}</span></div><StatusPill status={training.status} /></li>)}</ul> : <EmptyState>You have no active sessions right now. Your history is available under Training.</EmptyState>}
        </section>
        <section className="wb-card"><div className="wb-card-heading"><h2>Your player profile</h2><Link className="wb-button wb-button-link" to="/player/profile">Edit profile ↗</Link></div>
          <ul className="wb-list"><li className="wb-list-row"><span className="wb-list-main"><strong>Position</strong></span><span className="wb-list-end">{positionLabel(profile?.position ?? null)}</span></li><li className="wb-list-row"><span className="wb-list-main"><strong>Jersey number</strong></span><span className="wb-list-end">{profile?.jersey_number ?? '—'}</span></li><li className="wb-list-row"><span className="wb-list-main"><strong>Team</strong></span><span className="wb-list-end">{teamName ?? (profile?.team_id ? `#${profile.team_id}` : 'No team')}</span></li></ul>
          <Link className="wb-button wb-button-primary" to="/player/team" style={{ marginTop: 17 }}>Manage my team ↗</Link>
        </section>
      </div>
    </>}
  </main>
}
