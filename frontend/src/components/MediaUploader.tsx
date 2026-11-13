import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { errorText } from '../services/format'
import type { MediaAsset } from '../types/sports'

export function MediaUploader({ path, onUploaded }: { path: string; onUploaded: (assets: MediaAsset[]) => void }) {
  const { request } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    if (!files.length) return
    setBusy(true); setError(null)
    try {
      const body = new FormData()
      files.forEach((file) => body.append('files', file))
      const assets = await request<MediaAsset[]>(path, { method: 'POST', body })
      onUploaded(assets)
    } catch (cause) { setError(errorText(cause)) }
    finally { setBusy(false); event.target.value = '' }
  }
  return <div className="media-uploader"><label className="wb-button avatar-upload">{busy ? 'Uploading...' : '+ Add photos or videos'}
    <input hidden type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm" disabled={busy} onChange={(event) => void upload(event)} />
  </label><span className="wb-muted">Up to 5 files at once. Images: 8 MB; videos: 80 MB.</span>{error && <span className="media-error" role="alert">{error}</span>}</div>
}
