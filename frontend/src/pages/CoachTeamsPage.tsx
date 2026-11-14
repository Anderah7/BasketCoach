import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { DetailModal } from '../components/DetailModal'
import { EmptyState, Notice, PageHeading } from '../components/WorkspaceUI'
import { Avatar } from '../components/ProtectedMedia'
import { useAuth } from '../contexts/AuthContext'
import { errorText, formatDate, positionLabel } from '../services/format'
import type { Team, TeamPlayer, TeamPlayerDetail } from '../types/sports'

export function CoachTeamsPage() {
  const { request } = useAuth()
  const [teams, setTeams] = useState<Team[]>([])
  const [teamsLoading, setTeamsLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [players, setPlayers] = useState<TeamPlayer[]>([])
  const [rosterLoading, setRosterLoading] = useState(false)
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null)
  const [playerDetail, setPlayerDetail] = useState<TeamPlayerDetail | null>(null)
  const [playerLoading, setPlayerLoading] = useState(false)
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [editing, setEditing] = useState(false)
  const [confirmRemoval, setConfirmRemoval] = useState(false)
  const [jersey, setJersey] = useState('')
  const [strengths, setStrengths] = useState('')
  const [weaknesses, setWeaknesses] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    request<Team[]>('/teams/me', { signal: controller.signal }).then(setTeams)
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(errorText(cause)) })
      .finally(() => { if (!controller.signal.aborted) setTeamsLoading(false) })
    return () => controller.abort()
  }, [request])

  useEffect(() => {
    if (selectedId === null) return
    const controller = new AbortController()
    request<TeamPlayer[]>(`/teams/${selectedId}/players`, { signal: controller.signal }).then((items) => { if (!controller.signal.aborted) setPlayers(items) })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(errorText(cause)) })
      .finally(() => { if (!controller.signal.aborted) setRosterLoading(false) })
    return () => controller.abort()
  }, [request, selectedId])

  useEffect(() => {
    if (selectedId === null || selectedPlayerId === null) return
    const controller = new AbortController()
    request<TeamPlayerDetail>(`/teams/${selectedId}/players/${selectedPlayerId}`, { signal: controller.signal }).then((item) => { if (!controller.signal.aborted) setPlayerDetail(item) })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(errorText(cause)) })
      .finally(() => { if (!controller.signal.aborted) setPlayerLoading(false) })
    return () => controller.abort()
  }, [request, selectedId, selectedPlayerId])

  const selected = teams.find((team) => team.id === selectedId)

  function openTeam(id: number) {
    setPlayers([]); setRosterLoading(true); setSelectedId(id)
    setSelectedPlayerId(null); setPlayerDetail(null); setEditing(false); setConfirmRemoval(false)
    setError(null); setSuccess(null)
  }

  function openPlayer(id: number) {
    setSelectedPlayerId(id); setPlayerDetail(null); setPlayerLoading(true)
    setEditing(false); setConfirmRemoval(false); setError(null); setSuccess(null)
  }

  function backToRoster() {
    if (busy) return
    setSelectedPlayerId(null); setPlayerDetail(null); setEditing(false); setConfirmRemoval(false)
    setError(null)
  }

  function closeModal() {
    if (busy) return
    if (selectedPlayerId !== null) backToRoster()
    else { setSelectedId(null); setError(null); setSuccess(null) }
  }

  async function createTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); setSuccess(null)
    if (!name.trim()) { setError('Enter a team name.'); return }
    setBusy(true)
    try {
      const created = await request<Team>('/teams', { method: 'POST', body: { name: name.trim(), category: category.trim() || null } })
      setTeams((current) => [...current, created]); setName(''); setCategory('')
      openTeam(created.id)
      setSuccess('Team created. Share its invitation code with your players.')
    } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) }
  }

  function startEdit() {
    if (!playerDetail) return
    setEditing(true); setConfirmRemoval(false)
    setJersey(playerDetail.jersey_number?.toString() ?? '')
    setStrengths(playerDetail.strengths ?? ''); setWeaknesses(playerDetail.weaknesses ?? '')
    setError(null); setSuccess(null)
  }

  async function savePlayer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!playerDetail || selectedId === null) return
    setBusy(true); setError(null); setSuccess(null)
    try {
      const updated = await request<TeamPlayer>(`/teams/${selectedId}/players/${playerDetail.user_id}`, {
        method: 'PATCH', body: {
          jersey_number: jersey === '' ? null : Number(jersey),
          strengths: strengths.trim() || null, weaknesses: weaknesses.trim() || null,
        },
      })
      setPlayers((current) => current.map((player) => player.user_id === updated.user_id ? updated : player))
      setPlayerDetail((current) => current ? { ...current, ...updated } : current)
      setEditing(false); setSuccess('Player profile updated.')
    } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) }
  }

  async function removePlayer() {
    if (!playerDetail || selectedId === null) return
    setBusy(true); setError(null); setSuccess(null)
    try {
      await request<void>(`/teams/${selectedId}/players/${playerDetail.user_id}`, { method: 'DELETE' })
      setPlayers((current) => current.filter((item) => item.user_id !== playerDetail.user_id))
      setSelectedPlayerId(null); setPlayerDetail(null); setEditing(false); setConfirmRemoval(false)
      setSuccess(`${playerDetail.name} is no longer on this team.`)
    } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) }
  }

  return <main className="wb-page">
    <PageHeading kicker="ROSTER MANAGEMENT" title="My teams" description="Open a team to explore its roster and manage player profiles." />
    {!selected && error && <Notice kind="error">{error}</Notice>}
    <div className="wb-grid">
      <section className="wb-card">
        <div className="wb-card-heading"><h2>Your teams</h2><span className="wb-pill">{teams.length} teams</span></div>
        {teamsLoading ? <Notice>Loading teams...</Notice> : teams.length ? <div className="wb-team-cards">
          {teams.map((team) => <button key={team.id} type="button" className="wb-team-card" onClick={() => openTeam(team.id)}>
            <span className="wb-team-monogram" aria-hidden="true">{team.name.slice(0, 2).toUpperCase()}</span>
            <span className="wb-team-card-text"><strong>{team.name}</strong><span>{team.category ?? 'Category not set'}</span><small>Open team and roster</small></span>
            <span className="wb-card-arrow" aria-hidden="true">→</span>
          </button>)}
        </div> : <EmptyState>You do not manage any teams yet. Create your first team to get started.</EmptyState>}
      </section>
      <section className="wb-card">
        <div className="wb-card-heading"><h2>Create a team</h2></div>
        <form className="wb-form" onSubmit={createTeam}>
          <label className="wb-field">Name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required placeholder="e.g. Deusto Basketball" /></label>
          <label className="wb-field">Category<input value={category} onChange={(event) => setCategory(event.target.value)} maxLength={60} placeholder="e.g. Senior" /></label>
          <div className="wb-form-actions"><button className="wb-button wb-button-primary" disabled={busy}>Create team</button></div>
        </form>
      </section>
    </div>

    {selected && <DetailModal key={`${selected.id}-${selectedPlayerId ?? 'roster'}`} title={selectedPlayerId === null ? selected.name : playerDetail?.name ?? 'Player profile'} onClose={closeModal}>
      {selectedPlayerId !== null && <div><button className="wb-button" type="button" disabled={busy} onClick={backToRoster}>← Back to {selected.name}</button></div>}
      {error && <Notice kind="error">{error}</Notice>}
      {success && <Notice kind="success">{success}</Notice>}
      {selectedPlayerId === null ? <>
        <div className="wb-modal-summary"><span className="wb-pill">{selected.category ?? 'Category not set'}</span>{!rosterLoading && <span className="wb-pill">{players.length} players</span>}</div>
        <div className="wb-invitation"><span>Invitation code</span><strong>{selected.invitation_code ?? 'Unavailable'}</strong><small>Share this code with players so they can join your team.</small></div>
        <section className="wb-modal-section"><h3>Team roster</h3>
          {rosterLoading ? <Notice>Loading roster...</Notice> : players.length ? <div className="wb-stack">
            {players.map((player) => <button className="wb-roster-card" type="button" key={player.user_id} onClick={() => openPlayer(player.user_id)}>
              <Avatar id={player.avatar_media_id} name={player.name} className="roster-avatar" />
              <span className="wb-team-card-text"><strong>{player.name}</strong><span>{positionLabel(player.position)} · Jersey {player.jersey_number ?? 'not set'}</span><small>{player.height_cm ? `${player.height_cm} cm` : 'Height not set'} · {player.weight_kg ? `${player.weight_kg} kg` : 'Weight not set'}</small></span>
              <span className="wb-card-arrow" aria-hidden="true">→</span>
            </button>)}
          </div> : !error && <EmptyState>The roster is empty. Players can join using the invitation code.</EmptyState>}
        </section>
      </> : playerLoading ? <Notice>Loading player profile...</Notice> : playerDetail && <>
        <div className="wb-player-identity"><Avatar id={playerDetail.avatar_media_id} name={playerDetail.name} className="profile-avatar" /><div><h3>{playerDetail.name}</h3><p>{playerDetail.email}</p><span className="wb-pill">{playerDetail.is_active ? 'Active player' : 'Inactive account'}</span></div></div>
        <dl className="wb-profile-grid">
          <div><dt>Team</dt><dd>{selected.name}</dd></div><div><dt>Position</dt><dd>{positionLabel(playerDetail.position)}</dd></div>
          <div><dt>Jersey number</dt><dd>{playerDetail.jersey_number ?? 'Not assigned'}</dd></div><div><dt>Date of birth</dt><dd>{playerDetail.birth_date ? formatDate(playerDetail.birth_date) : 'Not set'}</dd></div>
          <div><dt>Height</dt><dd>{playerDetail.height_cm ? `${playerDetail.height_cm} cm` : 'Not set'}</dd></div><div><dt>Weight</dt><dd>{playerDetail.weight_kg ? `${playerDetail.weight_kg} kg` : 'Not set'}</dd></div>
          <div><dt>Account created</dt><dd>{formatDate(playerDetail.created_at)}</dd></div>
        </dl>
        <section className="wb-modal-section"><h3>Coach evaluation</h3><div className="wb-form-grid"><div><h4>Strengths</h4><p className="wb-modal-description">{playerDetail.strengths || 'Not evaluated yet.'}</p></div><div><h4>Weaknesses</h4><p className="wb-modal-description">{playerDetail.weaknesses || 'Not evaluated yet.'}</p></div></div></section>
        {editing ? <section className="wb-modal-section"><h3>Edit player</h3>
          <p className="wb-muted">You manage the jersey number and evaluations. Players update their own personal and sporting details.</p>
          <form className="wb-form" onSubmit={savePlayer}>
            <label className="wb-field">Jersey number<input type="number" min="0" max="99" value={jersey} onChange={(event) => setJersey(event.target.value)} placeholder="No jersey number" disabled={busy} /></label>
            <label className="wb-field">Strengths<textarea value={strengths} onChange={(event) => setStrengths(event.target.value)} disabled={busy} /></label>
            <label className="wb-field">Weaknesses<textarea value={weaknesses} onChange={(event) => setWeaknesses(event.target.value)} disabled={busy} /></label>
            <div className="wb-modal-actions"><button className="wb-button wb-button-primary" disabled={busy}>{busy ? 'Saving...' : 'Save changes'}</button><button className="wb-button" type="button" disabled={busy} onClick={() => setEditing(false)}>Cancel</button></div>
          </form>
        </section> : <div className="wb-modal-actions"><button className="wb-button wb-button-primary" type="button" disabled={busy} onClick={startEdit}>Edit player</button><button className="wb-button wb-button-danger" type="button" disabled={busy} onClick={() => setConfirmRemoval(true)}>Remove from team</button></div>}
        {confirmRemoval && <section className="wb-modal-section"><h3>Remove {playerDetail.name}?</h3><Notice>The player will leave this team and active training assignments will be cancelled. Their account, profile and training history will be kept.</Notice><div className="wb-modal-actions"><button type="button" className="wb-button wb-button-danger" disabled={busy} onClick={() => void removePlayer()}>{busy ? 'Removing...' : 'Confirm removal'}</button><button type="button" className="wb-button" disabled={busy} onClick={() => setConfirmRemoval(false)}>Cancel</button></div></section>}
      </>}
    </DetailModal>}
  </main>
}
