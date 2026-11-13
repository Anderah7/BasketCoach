import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { errorText } from '../services/format'
import { Avatar } from './ProtectedMedia'

export function AvatarEditor() {
  const { user, request, refreshUser } = useAuth()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  if (!user) return null

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setBusy(true); setMessage(null)
    try {
      const body = new FormData(); body.append('file', file)
      await request('/users/me/avatar', { method: 'PUT', body })
      await refreshUser()
      setMessage('Profile photo updated.')
    } catch (cause) { setMessage(errorText(cause)) }
    finally { setBusy(false); event.target.value = '' }
  }

  async function remove() {
    setBusy(true); setMessage(null)
    try {
      await request('/users/me/avatar', { method: 'DELETE' })
      await refreshUser()
      setMessage('Profile photo removed.')
    } catch (cause) { setMessage(errorText(cause)) }
    finally { setBusy(false) }
  }

  return <section className="wb-card avatar-editor"><div className="wb-card-heading"><h2>Profile photo</h2></div>
    <div className="avatar-editor-row"><Avatar id={user.avatar_media_id} name={user.name} className="profile-avatar" />
      <div><label className="wb-button avatar-upload">{busy ? 'Saving...' : 'Choose photo'}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => void upload(event)} disabled={busy} hidden /></label>
        {user.avatar_media_id !== null && <button type="button" className="wb-button" disabled={busy} onClick={() => void remove()}>Remove photo</button>}
        <p className="wb-muted">PNG, JPEG, WebP or GIF, up to 5 MB.</p></div></div>
    {message && <p className="wb-muted" role="status">{message}</p>}
  </section>
}
