import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { errorText } from '../services/format'
import { isValidUsername, normalizeUsername, usernameHint } from '../services/username'
import { Notice } from './WorkspaceUI'

export function UsernameEditor() {
  const { user, request, refreshUser } = useAuth()
  const [username, setUsername] = useState(user?.username ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => { setUsername(user?.username ?? '') }, [user?.username])
  if (!user) return null

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); setSuccess(null)
    if (!isValidUsername(username)) { setError(usernameHint); return }
    setBusy(true)
    try {
      await request('/users/me/username', { method: 'PATCH', body: { username: normalizeUsername(username) } })
      await refreshUser()
      setSuccess('Your public username has been updated.')
    } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) }
  }

  return <section className="wb-card" style={{ marginBottom: 18 }}>
    <div className="wb-card-heading"><div><h2>Public username</h2><p>{user.username ? `Your public identity is @${user.username}.` : 'Choose an optional alias so other users can find you.'}</p></div></div>
    {error && <Notice kind="error">{error}</Notice>}{success && <Notice kind="success">{success}</Notice>}
    <form className="wb-form" onSubmit={save} noValidate>
      <label className="wb-field">Username<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} minLength={3} maxLength={24} placeholder="e.g. coach_23" aria-describedby="profile-username-hint" disabled={busy} required /></label>
      <p className="wb-muted" id="profile-username-hint">{usernameHint} Your real name remains in your private account details.</p>
      <div className="wb-form-actions"><button className="wb-button wb-button-primary" disabled={busy || normalizeUsername(username) === user.username}>{busy ? 'Saving...' : 'Save username'}</button></div>
    </form>
  </section>
}
