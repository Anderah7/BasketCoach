import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { errorText } from '../services/format'
import type { ChatMessage } from '../types/chat'

export function LocalChatMedia({ file, onLoad }: { file: File; onLoad?: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const value = URL.createObjectURL(file)
    setUrl(value)
    return () => URL.revokeObjectURL(value)
  }, [file])
  if (!url) return null
  return file.type.startsWith('video/')
    ? <video className="chat-media" src={url} controls preload="metadata" onLoadedMetadata={onLoad} />
    : <img className="chat-media" src={url} alt="Selected attachment preview" onLoad={onLoad} />
}

export function ChatMedia({ message, onLoad }: { message: ChatMessage; onLoad?: () => void }) {
  const { requestBlob } = useAuth()
  const container = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [loadVideo, setLoadVideo] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [playbackError, setPlaybackError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!container.current) return
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) setVisible(true) }, { rootMargin: '200px' })
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!visible || (message.type === 'VIDEO' && !loadVideo) || message.type === 'TEXT') return
    const controller = new AbortController()
    let objectUrl: string | null = null
    setError(null)
    requestBlob(`/messages/${message.id}/media`, controller.signal, 'communication').then(blob => {
      if (controller.signal.aborted) return
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    }).catch(cause => { if (!controller.signal.aborted) setError(errorText(cause)) })
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [message.id, message.type, visible, loadVideo, requestBlob, revision])
  return <div ref={container} className="chat-media-container">
    {url ? message.type === 'VIDEO'
      ? <video className="chat-media" src={url} controls preload="metadata" onLoadedMetadata={onLoad} onError={() => setPlaybackError('Your browser could not play this video. Try a different file or codec.')} />
      : <a href={url} target="_blank" rel="noreferrer" aria-label="Open attached image"><img className="chat-media" src={url} alt={message.text || 'Chat image'} onLoad={onLoad} /></a>
      : error ? <div className="chat-media-placeholder" role="alert"><span>{error}</span><button className="wb-button" type="button" onClick={() => setRevision(current => current + 1)}>Try again</button></div>
      : message.type === 'VIDEO' && !loadVideo ? <button className="chat-media-placeholder chat-video-load" type="button" onClick={() => { setVisible(true); setLoadVideo(true) }}><span aria-hidden="true">▷</span>Load video{message.media && <small>{(message.media.size_bytes / 1024 / 1024).toFixed(1)} MB</small>}</button>
      : <div className="chat-media-placeholder" role="status">Loading {message.type === 'VIDEO' ? 'video' : 'image'}...</div>}
    {playbackError && <p className="chat-attachment-error" role="alert">{playbackError}</p>}
  </div>
}
