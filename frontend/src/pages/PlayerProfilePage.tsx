import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Notice, PageHeading } from '../components/WorkspaceUI'
import { useAuth } from '../contexts/AuthContext'
import { errorText, positionLabel } from '../services/format'
import { playerPositions } from '../types/sports'
import type { PlayerProfile } from '../types/sports'

export function PlayerProfilePage() {
  const { user, request } = useAuth()
  const [profile, setProfile] = useState<PlayerProfile | null>(null)
  const [position, setPosition] = useState('')
  const [height, setHeight] = useState('')
  const [weight, setWeight] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    request<PlayerProfile>('/players/me', { signal: controller.signal }).then((item) => {
      setProfile(item); setPosition(item.position ?? ''); setHeight(item.height_cm?.toString() ?? '')
      setWeight(item.weight_kg?.toString() ?? ''); setBirthDate(item.birth_date ?? '')
    }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(errorText(cause)) })
    return () => controller.abort()
  }, [request])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null); setSuccess(null)
    try {
      const updated = await request<PlayerProfile>('/players/me', { method: 'PATCH', body: {
        position: position || null, height_cm: height ? Number(height) : null,
        weight_kg: weight ? Number(weight) : null, birth_date: birthDate || null,
      } })
      setProfile(updated); setSuccess('Player profile updated.')
    } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) }
  }

  return <main className="wb-page">
    <PageHeading kicker="PLAYER PROFILE" title="Your player details" description="Update your sporting details. Your coach manages your jersey number and evaluations." />
    {error && <Notice kind="error">{error}</Notice>}{success && <Notice kind="success">{success}</Notice>}
    <div className="wb-grid"><section className="wb-card"><div className="wb-card-heading"><h2>Sporting details</h2></div><form className="wb-form" onSubmit={save}><label className="wb-field">Position<select value={position} onChange={(event) => setPosition(event.target.value)}><option value="">Not set</option>{playerPositions.map((item) => <option key={item} value={item}>{positionLabel(item)}</option>)}</select></label><div className="wb-form-grid"><label className="wb-field">Height (cm)<input type="number" min="1" value={height} onChange={(event) => setHeight(event.target.value)} placeholder="e.g. 185" /></label><label className="wb-field">Weight (kg)<input type="number" min="0.01" max="999.99" step="0.01" value={weight} onChange={(event) => setWeight(event.target.value)} placeholder="e.g. 78.5" /></label></div><label className="wb-field">Date of birth<input type="date" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} /></label><div className="wb-form-actions"><button className="wb-button wb-button-primary" disabled={busy || !profile}>{busy ? 'Saving...' : 'Save profile'}</button></div></form></section>
      <section className="wb-card"><div className="wb-card-heading"><h2>Account overview</h2></div><ul className="wb-list"><li className="wb-list-row"><div className="wb-list-main"><strong>Name</strong></div><span className="wb-list-end">{user?.name}</span></li><li className="wb-list-row"><div className="wb-list-main"><strong>Email</strong></div><span className="wb-list-end">{user?.email}</span></li><li className="wb-list-row"><div className="wb-list-main"><strong>Jersey number</strong></div><span className="wb-list-end">{profile?.jersey_number ?? 'Not assigned'}</span></li><li className="wb-list-row"><div className="wb-list-main"><strong>Strengths</strong></div><span className="wb-list-end">{profile?.strengths ?? 'Not evaluated'}</span></li><li className="wb-list-row"><div className="wb-list-main"><strong>Weaknesses</strong></div><span className="wb-list-end">{profile?.weaknesses ?? 'Not evaluated'}</span></li></ul></section>
    </div>
  </main>
}
