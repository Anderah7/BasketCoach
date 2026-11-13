import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { EmptyState, Notice, PageHeading } from '../components/WorkspaceUI'
import { Avatar } from '../components/ProtectedMedia'
import { useAuth } from '../contexts/AuthContext'
import { errorText, positionLabel } from '../services/format'
import type { Team, TeamPlayer } from '../types/sports'

export function CoachTeamsPage() {
  const { request } = useAuth()
  const [teams, setTeams] = useState<Team[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [players, setPlayers] = useState<TeamPlayer[]>([])
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [editing, setEditing] = useState<TeamPlayer | null>(null)
  const [jersey, setJersey] = useState('')
  const [strengths, setStrengths] = useState('')
  const [weaknesses, setWeaknesses] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    request<Team[]>('/teams/me', { signal: controller.signal }).then((items) => {
      setTeams(items); setSelectedId(items[0]?.id ?? null)
    }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(errorText(cause)) })
    return () => controller.abort()
  }, [request])

  useEffect(() => {
    if (selectedId === null) { setPlayers([]); return }
    const controller = new AbortController()
    request<TeamPlayer[]>(`/teams/${selectedId}/players`, { signal: controller.signal }).then(setPlayers)
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(errorText(cause)) })
    return () => controller.abort()
  }, [request, selectedId])

  const selected = teams.find((team) => team.id === selectedId)

  async function createTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); setSuccess(null)
    if (!name.trim()) { setError('Enter a team name.'); return }
    setBusy(true)
    try {
      const created = await request<Team>('/teams', { method: 'POST', body: { name: name.trim(), category: category.trim() || null } })
      setTeams((current) => [...current, created]); setSelectedId(created.id); setName(''); setCategory('')
      setSuccess('Team created. Share its invitation code with your players.')
    } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) }
  }

  function startEdit(player: TeamPlayer) {
    setEditing(player); setJersey(player.jersey_number === null ? '' : String(player.jersey_number))
    setStrengths(player.strengths ?? ''); setWeaknesses(player.weaknesses ?? '')
  }

  async function savePlayer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editing || selectedId === null) return
    setBusy(true); setError(null); setSuccess(null)
    try {
      const updated = await request<TeamPlayer>(`/teams/${selectedId}/players/${editing.user_id}`, {
        method: 'PATCH', body: {
          jersey_number: jersey === '' ? null : Number(jersey),
          strengths: strengths.trim() || null,
          weaknesses: weaknesses.trim() || null,
        },
      })
      setPlayers((current) => current.map((player) => player.user_id === updated.user_id ? updated : player))
      setEditing(null); setSuccess('Player profile updated.')
    } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) }
  }

  async function removePlayer(player: TeamPlayer) {
    if (selectedId === null || !window.confirm(`Remove ${player.name} from this team? Their active assignments will be cancelled.`)) return
    setBusy(true); setError(null); setSuccess(null)
    try {
      await request<void>(`/teams/${selectedId}/players/${player.user_id}`, { method: 'DELETE' })
      setPlayers((current) => current.filter((item) => item.user_id !== player.user_id))
      if (editing?.user_id === player.user_id) setEditing(null)
      setSuccess(`${player.name} is no longer on this team.`)
    } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) }
  }

  return <main className="wb-page">
    <PageHeading kicker="ROSTER MANAGEMENT" title="My teams" description="Create teams, share invitation codes and manage your roster." />
    {error && <Notice kind="error">{error}</Notice>}{success && <Notice kind="success">{success}</Notice>}
    <div className="wb-grid">
      <div className="wb-stack">
        <section className="wb-card"><div className="wb-card-heading"><h2>Selected team</h2><span className="wb-pill">{teams.length} teams</span></div>
          {teams.length ? <>
            <label className="wb-field">Choose a team<select value={selectedId ?? ''} onChange={(event) => { setSelectedId(Number(event.target.value)); setEditing(null) }}>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
            {selected && <div className="wb-list" style={{ marginTop: 15 }}><div className="wb-list-row"><div className="wb-list-main"><strong>Category</strong></div><span className="wb-list-end">{selected.category ?? 'Not set'}</span></div><div className="wb-list-row"><div className="wb-list-main"><strong>Players</strong></div><span className="wb-list-end">{players.length}</span></div><div className="wb-list-row"><div className="wb-list-main"><strong>Invitation code</strong></div><strong className="wb-list-end">{selected.invitation_code ?? 'Unavailable'}</strong></div></div>}
          </> : <EmptyState>You do not manage any teams yet. Create your first team to get started.</EmptyState>}
        </section>
        <section className="wb-card"><div className="wb-card-heading"><h2>Create a team</h2></div><form className="wb-form" onSubmit={createTeam}><label className="wb-field">Name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required placeholder="e.g. Deusto Basketball" /></label><label className="wb-field">Category<input value={category} onChange={(event) => setCategory(event.target.value)} maxLength={60} placeholder="e.g. Senior" /></label><div className="wb-form-actions"><button className="wb-button wb-button-primary" disabled={busy}>Create team</button></div></form></section>
      </div>
      <div className="wb-stack">
        <section className="wb-card"><div className="wb-card-heading"><div><h2>Roster</h2><p>Players currently on this team</p></div></div>
          {players.length ? <div className="wb-table-wrap"><table className="wb-table"><thead><tr><th>Player</th><th>Position</th><th>Jersey</th><th>Actions</th></tr></thead><tbody>{players.map((player) => <tr key={player.user_id}><td><div className="roster-person"><Avatar id={player.avatar_media_id} name={player.name} className="roster-avatar" /><strong>{player.name}</strong></div></td><td>{positionLabel(player.position)}</td><td>{player.jersey_number ?? '—'}</td><td><div className="wb-inline-actions"><button className="wb-button" onClick={() => startEdit(player)} disabled={busy}>Edit</button><button className="wb-button wb-button-danger" onClick={() => void removePlayer(player)} disabled={busy}>Remove</button></div></td></tr>)}</tbody></table></div> : <EmptyState>The roster is empty. Players can join using the invitation code.</EmptyState>}
        </section>
        {editing && <section className="wb-card"><div className="wb-card-heading"><h2>Edit {editing.name}</h2><button className="wb-button" onClick={() => setEditing(null)}>Close</button></div><form className="wb-form" onSubmit={savePlayer}><label className="wb-field">Jersey number<input type="number" min="0" max="99" value={jersey} onChange={(event) => setJersey(event.target.value)} placeholder="No jersey number" /></label><label className="wb-field">Strengths<textarea value={strengths} onChange={(event) => setStrengths(event.target.value)} /></label><label className="wb-field">Weaknesses<textarea value={weaknesses} onChange={(event) => setWeaknesses(event.target.value)} /></label><div className="wb-form-actions"><button className="wb-button wb-button-primary" disabled={busy}>Save changes</button></div></form></section>}
      </div>
    </div>
  </main>
}
