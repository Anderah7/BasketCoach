import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import type { MediaAsset } from '../types/sports'

export function ProtectedMedia({ id, kind, alt = '' }: { id: number; kind: 'image' | 'video'; alt?: string }) {
  const { requestBlob } = useAuth()
  const [url, setUrl] = useState<string | null>(null)
  const [active, setActive] = useState(kind === 'image')
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    let objectUrl: string | null = null
    requestBlob(`/media/${id}`, controller.signal).then((blob) => {
      if (controller.signal.aborted) return
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    }).catch(() => { if (!controller.signal.aborted) setUrl(null) })
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [id, requestBlob, active])
  if (!active) return <button className="wb-button" type="button" onClick={() => setActive(true)}>Load video</button>
  if (!url) return <span className="wb-muted">Loading media...</span>
  return kind === 'video'
    ? <video className="media-preview" src={url} controls preload="metadata" />
    : <img className="media-preview" src={url} alt={alt} />
}

export function MediaGallery({ assets, label, onRemove }: { assets: MediaAsset[]; label: string; onRemove?: (id: number) => void }) {
  if (!assets?.length) return null
  return <section className="wb-modal-section"><h3>{label}</h3><div className="media-gallery">
    {assets.map((asset) => <div key={asset.id} className="media-item"><ProtectedMedia id={asset.id} kind={asset.media_type} alt={label} />{onRemove && <button className="wb-button wb-button-danger" type="button" onClick={() => onRemove(asset.id)}>Remove</button>}</div>)}
  </div></section>
}

export function Avatar({ id, name, className }: { id: number | null; name: string; className: string }) {
  const { requestBlob } = useAuth()
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (id === null) { setUrl(null); return }
    const controller = new AbortController()
    let objectUrl: string | null = null
    requestBlob(`/media/${id}`, controller.signal).then((blob) => {
      if (controller.signal.aborted) return
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    }).catch(() => { if (!controller.signal.aborted) setUrl(null) })
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [id, requestBlob])
  return <span className={className}>{url ? <img className="avatar-image" src={url} alt={`${name}'s profile`} /> : name.charAt(0).toUpperCase()}</span>
}
