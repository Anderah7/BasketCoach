import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { EmptyState, MetricCard, Notice, PageHeading } from '../components/WorkspaceUI'
import { useAuth } from '../contexts/AuthContext'
import { errorText, formatDateTime } from '../services/format'
import type { Exercise, Team, TeamPlayer, TrainingListItem } from '../types/sports'

export function CoachDashboard() {
  const { user, request } = useAuth()
  const [teams, setTeams] = useState<Team[]>([])
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [selectedTeam, setSelectedTeam] = useState<number | null>(null)
  const [roster, setRoster] = useState<TeamPlayer[]>([])
  const [trainings, setTrainings] = useState<TrainingListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      request<Team[]>('/teams/me', { signal: controller.signal }),
      request<Exercise[]>('/exercises', { signal: controller.signal }),
    ]).then(([loadedTeams, loadedExercises]) => {
      setTeams(loadedTeams)
      setExercises(loadedExercises)
      setSelectedTeam(loadedTeams[0]?.id ?? null)
      setLoading(false)
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) { setError(errorText(cause)); setLoading(false) }
    })
    return () => controller.abort()
  }, [request])

  useEffect(() => {
    if (selectedTeam === null) { setRoster([]); setTrainings([]); return }
    const controller = new AbortController()
    Promise.all([
      request<TeamPlayer[]>(`/teams/${selectedTeam}/players`, { signal: controller.signal }),
      request<TrainingListItem[]>(`/trainings?team_id=${selectedTeam}`, { signal: controller.signal }),
    ]).then(([players, sessions]) => { setRoster(players); setTrainings(sessions) })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(errorText(cause)) })
    return () => controller.abort()
  }, [request, selectedTeam])

  const selected = teams.find((team) => team.id === selectedTeam)
  const latest = [...trainings].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4)

  return <main className="wb-page">
    <div className="wb-hero"><div><span className="wb-kicker">COACH DASHBOARD</span><h1>Hello, {user?.name.split(' ')[0]}.</h1><p>Your team, your sessions and your next decisions, all in one place.</p></div><span className="wb-hero-mark" aria-hidden="true">BC</span></div>
    <PageHeading kicker="OVERVIEW" title="Your season at a glance" description="Live data from your exercise catalogue and selected team." actions={<Link className="wb-button wb-button-primary" to="/coach/teams">Manage teams ↗</Link>} />
    {error && <Notice kind="error">{error}</Notice>}
    {loading ? <Notice>Loading your dashboard...</Notice> : <>
      {teams.length > 1 && <div className="wb-select-row"><label htmlFor="summary-team">Team</label><select id="summary-team" className="wb-input" value={selectedTeam ?? ''} onChange={(event) => setSelectedTeam(Number(event.target.value))}>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></div>}
      <div className="wb-metrics">
        <MetricCard label="Teams" value={teams.length} note="Managed by you" />
        <MetricCard label="Players" value={roster.length} note={selected?.name ?? 'Create a team'} />
        <MetricCard label="Exercises" value={exercises.length} note={`${exercises.filter((item) => item.created_by === user?.id && !item.is_public).length} private exercises of yours`} />
        <MetricCard label="Training sessions" value={trainings.length} note={selected?.name ?? 'No team selected'} />
      </div>
      <div className="wb-grid">
        <section className="wb-card"><div className="wb-card-heading"><h2>Recent sessions</h2><Link className="wb-button wb-button-link" to="/coach/trainings">View all ↗</Link></div>
          {latest.length ? <ul className="wb-list">{latest.map((training) => <li className="wb-list-row" key={training.id}><div className="wb-list-main"><strong>{training.title}</strong><span>{formatDateTime(training.date)} · {training.duration} min</span></div><span className="wb-pill">{training.creation_mode === 'AI' ? 'AI' : 'Manual'}</span></li>)}</ul> : <EmptyState>This team has no training sessions yet. Create one from the Training page.</EmptyState>}
        </section>
        <section className="wb-card"><div className="wb-card-heading"><h2>Quick access</h2></div><div className="wb-stack">
          <Link className="wb-list-row" to="/coach/exercises"><span className="wb-list-main"><strong>Exercise catalogue</strong><span>Browse and create private exercises</span></span><span>↗</span></Link>
          <Link className="wb-list-row" to="/coach/trainings"><span className="wb-list-main"><strong>Plan a session</strong><span>Organise exercises and assignments</span></span><span>↗</span></Link>
          <Link className="wb-list-row" to="/coach/ai"><span className="wb-list-main"><strong>AI assistant</strong><span>Generate a proposal to review</span></span><span>↗</span></Link>
        </div></section>
      </div>
    </>}
  </main>
}
