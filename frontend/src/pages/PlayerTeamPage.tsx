import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { EmptyState, Notice, PageHeading } from '../components/WorkspaceUI'
import { useAuth } from '../contexts/AuthContext'
import { errorText, positionLabel } from '../services/format'
import type { PlayerProfile } from '../types/sports'

interface JoinedTeam { message: string; team: { id: number; name: string; category: string | null } }

export function PlayerTeamPage() {
  const { request } = useAuth()
  const [profile, setProfile] = useState<PlayerProfile | null>(null)
  const [code, setCode] = useState('')
  const [teamName, setTeamName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    request<PlayerProfile>('/players/me', { signal: controller.signal }).then((item) => { setProfile(item); setLoading(false) })
      .catch((cause: unknown) => { if (!controller.signal.aborted) { setError(errorText(cause)); setLoading(false) } })
    return () => controller.abort()
  }, [request])

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); setSuccess(null)
    if (!profile || !code.trim()) { setError('Wait for your profile to load and enter the invitation code.'); return }
    setBusy(true)
    try {
      const result = await request<JoinedTeam>('/players/me/team', { method: 'POST', body: { invitation_code: code.trim() } })
      setProfile((current) => current && { ...current, team_id: result.team.id })
      setTeamName(result.team.name); setCode(''); setSuccess(`You have joined ${result.team.name}.`)
    } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) }
  }

  async function leave() {
    if (!profile?.team_id || !window.confirm('Leave this team? Your active assignments will be cancelled, but your history will be kept.')) return
    setBusy(true); setError(null); setSuccess(null)
    try {
      await request<void>('/players/me/team', { method: 'DELETE' })
      setProfile((current) => current && { ...current, team_id: null, jersey_number: null, strengths: null, weaknesses: null })
      setTeamName(null); setSuccess('You have left the team. Your history remains under Training.')
    } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) }
  }

  return <main className="wb-page">
    <PageHeading kicker="MY TEAM" title="Your place on the court" description="Join a managed team or check your current membership." />
    {error && <Notice kind="error">{error}</Notice>}{success && <Notice kind="success">{success}</Notice>}
    <div className="wb-grid">
      <section className="wb-card"><div className="wb-card-heading"><h2>Current team</h2></div>
        {loading ? <Notice>Loading your team...</Notice> : profile?.team_id ? <div className="wb-stack"><div className="wb-team-identity"><span className="wb-team-monogram">BC</span><div><strong>{teamName ?? `Team #${profile.team_id}`}</strong><span>Roster member</span></div></div><ul className="wb-list"><li className="wb-list-row"><span className="wb-list-main"><strong>Team ID</strong></span><span className="wb-list-end">#{profile.team_id}</span></li><li className="wb-list-row"><span className="wb-list-main"><strong>Position</strong></span><span className="wb-list-end">{positionLabel(profile.position)}</span></li><li className="wb-list-row"><span className="wb-list-main"><strong>Jersey number</strong></span><span className="wb-list-end">{profile.jersey_number ?? 'Not assigned'}</span></li></ul><div className="wb-inline-actions"><Link className="wb-button" to="/player/profile">Edit profile</Link><button className="wb-button wb-button-danger" onClick={() => void leave()} disabled={busy}>Leave team</button></div></div> : <EmptyState>You do not belong to a team right now. Ask a coach for an invitation code to join.</EmptyState>}
      </section>
      <section className="wb-card"><div className="wb-card-heading"><h2>Join a team</h2></div>{profile?.team_id ? <Notice>You can only belong to one team at a time. Leave your current team before joining another.</Notice> : <form className="wb-form" onSubmit={join}><p className="wb-muted">The coach of a managed team can give you an invitation code.</p><label className="wb-field">Invitation code<input value={code} onChange={(event) => setCode(event.target.value)} maxLength={32} placeholder="Paste the code here" required disabled={!profile || busy} /></label><div className="wb-form-actions"><button className="wb-button wb-button-primary" disabled={busy || !profile}>{busy ? 'Joining...' : 'Join team'}</button></div></form>}</section>
    </div>
  </main>
}
