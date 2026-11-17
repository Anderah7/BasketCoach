import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { DetailModal } from '../components/DetailModal'
import { EmptyState, MetricCard, Notice, PageHeading } from '../components/WorkspaceUI'
import { useAuth } from '../contexts/AuthContext'
import { errorText, formatDateTime, toLocalDateTime } from '../services/format'
import { calendarDays, localDayKey, matchesPath, matchStatusLabel } from '../services/matches'
import type { Match, MatchInput, MatchOptions, MatchPage, MatchStatus } from '../types/matches'
import type { PlayerProfile } from '../types/sports'
import './matches.css'

type Modal = { mode: 'create' } | { mode: 'detail' | 'edit' | 'result' | 'cancel'; match: Match }
interface Draft { home: string; away: string; date: string; location: string; season: string }

function Status({ value }: { value: MatchStatus }) {
  return <span className={`match-status match-status-${value.toLowerCase()}`}>{matchStatusLabel[value]}</span>
}

function Score({ match }: { match: Match }) {
  return <span className="match-score">{match.status === 'FINISHED' ? `${match.home_score} : ${match.away_score}` : 'vs'}</span>
}

export function MatchesPage() {
  const { user, request } = useAuth()
  const isCoach = user?.role === 'coach'
  const isPlayer = user?.role === 'player'
  const [options, setOptions] = useState<MatchOptions | null>(null)
  const [teamId, setTeamId] = useState('')
  const [seasonId, setSeasonId] = useState('')
  const [status, setStatus] = useState<MatchStatus | ''>('')
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [view, setView] = useState<'calendar' | 'agenda'>('calendar')
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(false)
  const [bootError, setBootError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [bootVersion, setBootVersion] = useState(0)
  const [modal, setModal] = useState<Modal | null>(null)
  const [modalError, setModalError] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<Draft>({ home: '', away: '', date: '', location: '', season: '' })
  const [scores, setScores] = useState({ home: '', away: '' })
  const detailRequest = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setOptions(null); setBootError(null)
    Promise.all([
      request<MatchOptions>('/matches/options', { signal: controller.signal }),
      isPlayer ? request<PlayerProfile>('/players/me', { signal: controller.signal }) : Promise.resolve(null),
    ]).then(([data, profile]) => {
      if (controller.signal.aborted) return
      const firstOwn = data.teams.find(team => team.coach_id === user?.id)
      setTeamId(isPlayer ? String(profile?.team_id ?? '') : isCoach ? String(firstOwn?.id ?? '') : '')
      setOptions(data)
    }).catch((cause: unknown) => { if (!controller.signal.aborted) setBootError(errorText(cause)) })
    return () => controller.abort()
  }, [request, user?.id, isCoach, isPlayer, bootVersion])

  const hasTeam = !(isCoach || isPlayer) || Boolean(teamId)
  useEffect(() => {
    if (!options || !hasTeam) { setMatches([]); return }
    const controller = new AbortController()
    setLoading(true); setError(null); setMatches([])
    async function load() {
      try {
        const items: Match[] = []
        let page: MatchPage
        do {
          page = await request<MatchPage>(matchesPath(month, teamId, seasonId, status, items.length), { signal: controller.signal })
          items.push(...page.items)
        } while (page.items.length && items.length < page.total)
        if (!controller.signal.aborted) setMatches(items)
      } catch (cause) { if (!controller.signal.aborted) setError(errorText(cause)) }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }
    void load()
    return () => controller.abort()
  }, [request, options, hasTeam, month, teamId, seasonId, status, version])

  useEffect(() => () => detailRequest.current?.abort(), [])

  const visibleTeams = options?.teams.filter(team => !isCoach || team.coach_id === user?.id) ?? []
  const days = calendarDays(month)
  const today = localDayKey(new Date())
  const byDay = new Map<string, Match[]>()
  for (const match of matches) {
    const key = localDayKey(new Date(match.match_date))
    byDay.set(key, [...(byDay.get(key) ?? []), match])
  }

  function closeModal() {
    if (busy) return
    detailRequest.current?.abort()
    setDetailLoading(false); setModal(null); setModalError(null)
  }

  async function openMatch(match: Match) {
    detailRequest.current?.abort()
    const controller = new AbortController()
    detailRequest.current = controller
    setModal({ mode: 'detail', match }); setModalError(null); setDetailLoading(true)
    try {
      const current = await request<Match>(`/matches/${match.id}`, { signal: controller.signal })
      if (!controller.signal.aborted) setModal({ mode: 'detail', match: current })
    } catch (cause) { if (!controller.signal.aborted) setModalError(errorText(cause)) }
    finally { if (!controller.signal.aborted) setDetailLoading(false) }
  }

  function create() {
    setDraft({ home: teamId, away: '', date: toLocalDateTime(new Date(month.getFullYear(), month.getMonth(), month.getFullYear() === new Date().getFullYear() && month.getMonth() === new Date().getMonth() ? new Date().getDate() : 1, 18).toISOString()), location: '', season: '' })
    setModalError(null); setModal({ mode: 'create' })
  }

  function edit(match: Match) {
    setDraft({ home: String(match.home_team.id), away: String(match.away_team.id),
      date: toLocalDateTime(match.match_date), location: match.location ?? '', season: String(match.season?.id ?? '') })
    setModalError(null); setModal({ mode: 'edit', match })
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!modal || (modal.mode !== 'create' && modal.mode !== 'edit')) return
    setModalError(null)
    if (draft.home === draft.away) { setModalError('A team cannot play against itself.'); return }
    const input: MatchInput = { home_team_id: Number(draft.home), away_team_id: Number(draft.away),
      match_date: new Date(draft.date).toISOString(), location: draft.location.trim() || null,
      season_id: draft.season ? Number(draft.season) : null }
    if (!options?.teams.some(team => [input.home_team_id, input.away_team_id].includes(team.id) && team.coach_id === user?.id)) {
      setModalError('Choose at least one team that you coach.'); return
    }
    setBusy(true)
    try {
      const current = await request<Match>(modal.mode === 'create' ? '/matches' : `/matches/${modal.match.id}`, {
        method: modal.mode === 'create' ? 'POST' : 'PATCH',
        body: modal.mode === 'create' ? input : { match_date: input.match_date, location: input.location, season_id: input.season_id },
      })
      setModal({ mode: 'detail', match: current }); setSuccess(modal.mode === 'create' ? 'Match created.' : 'Match updated.')
      const date = new Date(current.match_date)
      setMonth(new Date(date.getFullYear(), date.getMonth(), 1)); setSeasonId(''); setStatus('')
      if (![current.home_team.id, current.away_team.id].includes(Number(teamId))) {
        setTeamId(String(current.home_team.coach_id === user?.id ? current.home_team.id : current.away_team.id))
      }
      setVersion(value => value + 1)
    } catch (cause) { setModalError(errorText(cause)); setVersion(value => value + 1) }
    finally { setBusy(false) }
  }

  async function finish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!modal || modal.mode !== 'result') return
    await transition(modal.match, 'result', { home_score: Number(scores.home), away_score: Number(scores.away) })
  }

  async function transition(match: Match, action: 'result' | 'cancel', body?: unknown) {
    setBusy(true); setModalError(null)
    try {
      const current = await request<Match>(`/matches/${match.id}/${action}`, { method: 'PATCH', body })
      setModal({ mode: 'detail', match: current }); setSuccess(action === 'result' ? 'Result recorded.' : 'Match cancelled.')
      setVersion(value => value + 1)
    } catch (cause) { setModalError(errorText(cause)); setVersion(value => value + 1) }
    finally { setBusy(false) }
  }

  const selected = modal && 'match' in modal ? modal.match : null
  const editing = modal?.mode === 'create' || modal?.mode === 'edit'
  const seasonOptions = options?.seasons.filter(season =>
    season.team_ids.includes(Number(draft.home)) && season.team_ids.includes(Number(draft.away))) ?? []

  return <main className="wb-page matches-page">
    <PageHeading kicker="GAME DAY" title="Matches & calendar" description={isCoach ? 'Plan the next tip-off. Keep every fixture and result in one place.' : isPlayer ? 'Your team’s fixtures, game days and final scores.' : 'Follow the teams, find the next game and catch up on results.'}
      actions={isCoach && <button className="wb-button wb-button-primary" onClick={create} disabled={!options || !hasTeam}>+ New match</button>} />
    {bootError && <Notice kind="error">{bootError} <button className="wb-button wb-button-link" onClick={() => setBootVersion(value => value + 1)}>Try again</button></Notice>}
    {success && <Notice kind="success">{success}</Notice>}
    {error && <Notice kind="error">{error} <button className="wb-button wb-button-link" onClick={() => setVersion(value => value + 1)}>Try again</button></Notice>}
    {!options && !bootError && <Notice>Loading the calendar...</Notice>}
    {options && !hasTeam && <section className="wb-card"><EmptyState>{isCoach ? 'Create a team before scheduling your first match.' : 'Join a team to see its calendar.'} <Link className="wb-button" to={isCoach ? '/coach/teams' : '/player/team'}>{isCoach ? 'My teams' : 'My team'}</Link></EmptyState></section>}
    {options && hasTeam && <>
      <div className="matches-metrics">
        <MetricCard label="This month" value={matches.length} note="Matches in your selection" />
        <MetricCard label="Coming up" value={matches.filter(match => match.status === 'SCHEDULED').length} note="Scheduled fixtures" />
        <MetricCard label="Full time" value={matches.filter(match => match.status === 'FINISHED').length} note="Results recorded" />
      </div>
      <section className="wb-card matches-card" aria-busy={loading}>
        <div className="matches-filters">
          <label className="wb-field">Team<select value={teamId} disabled={isPlayer} onChange={event => setTeamId(event.target.value)}>
            {!isCoach && !isPlayer && <option value="">All teams</option>}
            {visibleTeams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select></label>
          <label className="wb-field">Season<select value={seasonId} onChange={event => setSeasonId(event.target.value)}><option value="">All seasons & friendlies</option>{options.seasons.map(season => <option key={season.id} value={season.id}>{season.name}</option>)}</select></label>
          <label className="wb-field">Status<select value={status} onChange={event => setStatus(event.target.value as MatchStatus | '')}><option value="">All statuses</option>{Object.entries(matchStatusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        <div className="matches-toolbar">
          <div className="matches-month"><button className="wb-button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month">‹</button><h2>{new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(month)}</h2><button className="wb-button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month">›</button><button className="wb-button wb-button-link" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Today</button></div>
          <div className="matches-view"><button type="button" aria-pressed={view === 'calendar'} onClick={() => setView('calendar')}>Calendar</button><button type="button" aria-pressed={view === 'agenda'} onClick={() => setView('agenda')}>Agenda</button><button type="button" onClick={() => setVersion(value => value + 1)} disabled={loading}>Refresh</button></div>
        </div>
        {loading ? <Notice>Loading matches...</Notice> : view === 'calendar' ? <>
          <div className="matches-calendar-scroll"><div className="matches-calendar" aria-label="Monthly match calendar">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => <div className="matches-weekday" key={day}>{day}</div>)}
            {days.map(day => {
              const key = localDayKey(day)
              const active = day.getMonth() === month.getMonth()
              return <div key={key} className={`matches-day${active ? '' : ' matches-day-muted'}${key === today ? ' matches-day-today' : ''}`}><time dateTime={key}>{day.getDate()}</time>{active && byDay.get(key)?.map(match => <button key={match.id} className={`matches-event matches-event-${match.status.toLowerCase()}`} onClick={() => void openMatch(match)} title={`${match.home_team.name} vs ${match.away_team.name}`}><span>{new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(match.match_date))} · {matchStatusLabel[match.status]}</span><strong>{match.home_team.name}</strong><small>vs {match.away_team.name}</small>{match.status === 'FINISHED' && <b>{match.home_score} : {match.away_score}</b>}</button>)}</div>
            })}
          </div></div>
          {!matches.length && <EmptyState>No matches in this selection. Try another month or change your filters.</EmptyState>}
        </> : matches.length ? <ul className="matches-agenda">{matches.map(match => <li key={match.id}><button className="matches-agenda-row" onClick={() => void openMatch(match)}><span className="matches-agenda-date"><strong>{new Date(match.match_date).getDate()}</strong><span>{new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(new Date(match.match_date))}</span></span><span className="matches-agenda-content"><span className="matches-fixture"><strong>{match.home_team.name}</strong><Score match={match} /><strong>{match.away_team.name}</strong></span><span className="wb-muted">{formatDateTime(match.match_date)} · {match.location || 'Venue to be confirmed'}</span><span className="wb-muted">{match.season?.name ?? 'Friendly'}</span></span><Status value={match.status} /><span className="wb-card-arrow" aria-hidden="true">↗</span></button></li>)}</ul> : <EmptyState>No matches in this selection. Try another month or change your filters.</EmptyState>}
      </section>
      <p className="wb-muted matches-footnote">Times are shown in your local timezone. Select a match to see all details.</p>
    </>}
    {modal && <DetailModal title={modal.mode === 'create' ? 'New match' : modal.mode === 'edit' ? 'Edit match' : modal.mode === 'result' ? 'Record result' : modal.mode === 'cancel' ? 'Cancel match' : 'Match details'} onClose={closeModal}>
      {modalError && <Notice kind="error">{modalError}</Notice>}
      {detailLoading && <Notice>Loading match details...</Notice>}
      {editing ? <form className="wb-form" onSubmit={save}>
        <div className="wb-form-grid"><label className="wb-field">Home team<select value={draft.home} required disabled={busy || modal.mode === 'edit'} onChange={event => setDraft({ ...draft, home: event.target.value, season: '' })}><option value="">Choose a team</option>{options?.teams.map(team => <option key={team.id} value={team.id} disabled={String(team.id) === draft.away}>{team.name}</option>)}</select></label><label className="wb-field">Away team<select value={draft.away} required disabled={busy || modal.mode === 'edit'} onChange={event => setDraft({ ...draft, away: event.target.value, season: '' })}><option value="">Choose a team</option>{options?.teams.map(team => <option key={team.id} value={team.id} disabled={String(team.id) === draft.home}>{team.name}</option>)}</select></label></div>
        <div className="wb-form-grid"><label className="wb-field">Date and time<input type="datetime-local" required value={draft.date} disabled={busy} onChange={event => setDraft({ ...draft, date: event.target.value })} /></label><label className="wb-field">Venue (optional)<input value={draft.location} maxLength={150} disabled={busy} onChange={event => setDraft({ ...draft, location: event.target.value })} placeholder="Sports hall or court" /></label></div>
        <label className="wb-field">Season (optional)<select value={draft.season} disabled={busy} onChange={event => setDraft({ ...draft, season: event.target.value })}><option value="">Friendly / no season</option>{seasonOptions.map(season => <option key={season.id} value={season.id}>{season.name}</option>)}</select></label>
        <p className="wb-muted">At least one participating team must be yours. Both teams must be enrolled in the selected season. The date must fall within that season.</p>
        <div className="wb-form-actions"><button type="button" className="wb-button" disabled={busy} onClick={closeModal}>Close</button><button className="wb-button wb-button-primary" disabled={busy}>{busy ? 'Saving...' : 'Save match'}</button></div>
      </form> : selected && <div className="wb-stack">
        <div className="match-detail-score"><div><span>HOME</span><strong>{selected.home_team.name}</strong></div><Score match={selected} /><div><span>AWAY</span><strong>{selected.away_team.name}</strong></div></div>
        <div className="match-detail-status"><Status value={selected.status} /></div>
        <dl className="wb-profile-grid"><div><dt>Date & time</dt><dd>{formatDateTime(selected.match_date)}</dd></div><div><dt>Venue</dt><dd>{selected.location || 'To be confirmed'}</dd></div><div><dt>Season</dt><dd>{selected.season?.name ?? 'Friendly'}</dd></div><div><dt>Match</dt><dd>#{selected.id}</dd></div></dl>
        {modal.mode === 'result' ? <form className="wb-form" onSubmit={finish}><Notice>Recording a result finishes the match. It cannot be edited or cancelled afterwards.</Notice><div className="wb-form-grid"><label className="wb-field">Home score<input type="number" min="0" max="2147483647" step="1" required value={scores.home} disabled={busy} onChange={event => setScores({ ...scores, home: event.target.value })} /></label><label className="wb-field">Away score<input type="number" min="0" max="2147483647" step="1" required value={scores.away} disabled={busy} onChange={event => setScores({ ...scores, away: event.target.value })} /></label></div><div className="wb-form-actions"><button className="wb-button" type="button" disabled={busy} onClick={() => { setModalError(null); setModal({ mode: 'detail', match: selected }) }}>Back</button><button className="wb-button wb-button-primary" disabled={busy}>{busy ? 'Saving...' : 'Confirm result'}</button></div></form>
          : modal.mode === 'cancel' ? <><Notice>This match will stay in the calendar as cancelled. You cannot undo this action.</Notice><div className="wb-inline-actions"><button className="wb-button" disabled={busy} onClick={() => { setModalError(null); setModal({ mode: 'detail', match: selected }) }}>Keep match</button><button className="wb-button wb-button-danger" disabled={busy} onClick={() => void transition(selected, 'cancel')}>{busy ? 'Cancelling...' : 'Confirm cancellation'}</button></div></>
          : selected.can_manage && selected.status === 'SCHEDULED' && <><p className="wb-muted">Either participating team’s coach can manage this scheduled match.</p><div className="wb-inline-actions"><button className="wb-button" disabled={detailLoading || Boolean(modalError)} onClick={() => edit(selected)}>Edit match</button><button className="wb-button wb-button-primary" disabled={detailLoading || Boolean(modalError)} onClick={() => { setScores({ home: '', away: '' }); setModalError(null); setModal({ mode: 'result', match: selected }) }}>Record result</button><button className="wb-button wb-button-danger" disabled={detailLoading || Boolean(modalError)} onClick={() => { setModalError(null); setModal({ mode: 'cancel', match: selected }) }}>Cancel match</button></div></>}
      </div>}
    </DetailModal>}
  </main>
}
