import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { DetailModal } from '../components/DetailModal'
import { ChatMedia, LocalChatMedia } from '../components/ChatMedia'
import { Avatar } from '../components/ProtectedMedia'
import { Notice } from '../components/WorkspaceUI'
import { useAuth } from '../contexts/AuthContext'
import { useChat } from '../hooks/useChat'
import { attachmentType, conversationLabel, messagePreview } from '../services/chat'
import { errorText } from '../services/format'
import { publicRoleLabel, publicUserLabel } from '../services/social'
import type { ConnectionState } from '../types/chat'
import type { Friend } from '../types/social'
import './chat.css'

function ChatIcon({ name }: { name: 'bubble' | 'send' | 'back' | 'plus' | 'search' | 'attach' }) {
  const paths = {
    bubble: <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" />,
    send: <><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></>,
    back: <path d="m12 19-7-7 7-7M5 12h15" />,
    plus: <path d="M12 5v14M5 12h14" />,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
    attach: <path d="m21 11-8 8a6 6 0 0 1-8-8L14 2a4 4 0 0 1 6 6l-9 9a2 2 0 0 1-3-3l8-8" />,
  }
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

const stateLabel: Record<ConnectionState, string> = {
  connecting: 'Connecting', connected: 'Connected', reconnecting: 'Reconnecting', offline: 'Offline', error: 'Unavailable',
}
const clock = (value: string) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
const dayKey = (value: string) => new Date(value).toLocaleDateString('en-CA')
function dayLabel(value: string) {
  if (dayKey(value) === dayKey(new Date().toISOString())) return 'Today'
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
  if (dayKey(value) === dayKey(yesterday.toISOString())) return 'Yesterday'
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(value))
}

function NewConversation({ onClose, start }: { onClose: () => void; start: (id: number, signal: AbortSignal) => Promise<void> }) {
  const { request } = useAuth()
  const [friends, setFriends] = useState<Friend[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [revision, setRevision] = useState(0)
  const sendController = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(null)
    request<Friend[]>('/friends', { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setFriends(result)
    }).catch(cause => { if (!controller.signal.aborted) setError(errorText(cause)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort(); sendController.current?.abort() }
  }, [request, revision])
  async function choose(id: number) {
    if (busy !== null) return
    const controller = new AbortController()
    sendController.current = controller
    setBusy(id); setError(null)
    try { await start(id, controller.signal) }
    catch (cause) { if (!controller.signal.aborted) setError(errorText(cause)) }
    finally { if (!controller.signal.aborted) setBusy(null) }
  }
  const filtered = friends.filter(friend => publicUserLabel(friend).toLowerCase().includes(query.trim().toLowerCase()))
  return <DetailModal title="New conversation" onClose={onClose}>
    <p className="wb-modal-description">Choose a friend and take the conversation off the court.</p>
    <label className="wb-field">Find a friend<input autoFocus type="search" placeholder="Search by username" value={query} onChange={event => setQuery(event.target.value)} /></label>
    {error && <Notice kind="error">{error} <button className="wb-button wb-button-link" type="button" onClick={() => setRevision(current => current + 1)}>Refresh friends</button></Notice>}
    {loading ? <Notice>Loading your friends...</Notice> : friends.length === 0 ? <div className="chat-dialog-empty"><p>Your next conversation starts with a connection.</p><Link to="/friends/search" className="wb-button wb-button-primary" onClick={onClose}>Find people</Link></div> :
      <div className="chat-friend-list">{filtered.map(friend => <button key={friend.id} className="chat-friend" type="button" disabled={busy !== null} onClick={() => void choose(friend.id)}>
        <Avatar id={friend.avatar_media_id} name={friend.username ?? 'User'} className="chat-avatar" /><span><strong>{publicUserLabel(friend)}</strong><small>{publicRoleLabel[friend.role]}</small></span><span className="chat-friend-action">{busy === friend.id ? 'Opening...' : 'Message'} <ChatIcon name="bubble" /></span>
      </button>)}{filtered.length === 0 && <p className="wb-muted">No friends match your search.</p>}</div>}
  </DetailModal>
}

export function ChatPage() {
  const { user } = useAuth()
  const { conversationId } = useParams<{ conversationId: string }>()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const chat = useChat(conversationId)
  const { startConversation } = chat
  const [newOpen, setNewOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)
  const [openRevision, setOpenRevision] = useState(0)
  const [showLatest, setShowLatest] = useState(false)
  const [attachment, setAttachment] = useState<{ conversationId: string; file: File } | null>(null)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)
  const anchor = useRef<{ top: number; height: number } | null>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const friendParam = params.get('user')

  useEffect(() => {
    if (friendParam === null) { setOpenError(null); return }
    const id = Number(friendParam)
    if (!/^\d+$/.test(friendParam) || !Number.isSafeInteger(id) || id <= 0 || id === user?.id) {
      setOpenError('Choose another user from your friends list.'); return
    }
    const controller = new AbortController()
    setOpening(true); setOpenError(null)
    startConversation(id, controller.signal).then(result => {
      if (!controller.signal.aborted) navigate(`/chat/${result.id}`, { replace: true })
    }).catch(error => { if (!controller.signal.aborted) setOpenError(errorText(error)) })
      .finally(() => { if (!controller.signal.aborted) setOpening(false) })
    return () => controller.abort()
  }, [friendParam, startConversation, navigate, user?.id, openRevision])

  useLayoutEffect(() => { nearBottom.current = true; anchor.current = null; setShowLatest(false) }, [conversationId])
  useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return
    if (anchor.current) {
      element.scrollTop = anchor.current.top + element.scrollHeight - anchor.current.height
      anchor.current = null
    } else if (nearBottom.current) element.scrollTop = element.scrollHeight
  }, [chat.history.items, chat.outgoing.length, conversationId, attachment])
  useEffect(() => { if (chat.history.error) anchor.current = null }, [chat.history.error])

  async function start(id: number, signal: AbortSignal) {
    const conversation = await startConversation(id, signal)
    if (!signal.aborted) { setNewOpen(false); navigate(`/chat/${conversation.id}`) }
  }
  function submit(event?: FormEvent) {
    event?.preventDefault()
    if (!conversationId) return
    const file = attachment?.conversationId === conversationId ? attachment.file : null
    let sent = false
    try { sent = file ? chat.sendAttachment(file, drafts[conversationId] ?? '') : chat.sendText(drafts[conversationId] ?? '') }
    catch (error) { setAttachmentError(errorText(error)); return }
    if (sent) {
      nearBottom.current = true; setShowLatest(false)
      setDrafts(current => ({ ...current, [conversationId]: '' }))
      if (file) setAttachment(null)
      setAttachmentError(null)
      composer.current?.focus()
    }
  }
  function composerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit() }
  }
  function older() {
    if (!conversationId || !chat.history.cursor) return
    if (viewport.current) anchor.current = { top: viewport.current.scrollTop, height: viewport.current.scrollHeight }
    void chat.loadHistory(conversationId, chat.history.cursor)
  }
  const label = chat.selected ? conversationLabel(chat.selected, user!.id) : 'Conversation'
  const draft = conversationId ? drafts[conversationId] ?? '' : ''
  const validId = !conversationId || /^[a-f0-9]{24}$/i.test(conversationId)
  const sendEnabled = chat.access === 'allowed' && chat.connectionState === 'connected' && chat.history.loaded && !chat.history.error
  const selectedFile = attachment && attachment.conversationId === conversationId ? attachment.file : null
  const rows = [
    ...chat.history.items.map(message => ({ key: message.id, text: message.text, date: message.created_at, own: message.sender_id === user!.id, pending: null, message })),
    ...chat.outgoing.filter(item => !chat.history.items.some(message => message.client_message_id === item.client_message_id && message.sender_id === user!.id))
      .map(item => ({ key: item.client_message_id, text: item.text, date: item.created_at, own: true, pending: item, message: null })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key))
  const filtered = chat.conversations.filter(item => conversationLabel(item, user!.id).toLowerCase().includes(search.trim().toLowerCase()))
  const mediaLoaded = () => { if (viewport.current && nearBottom.current) viewport.current.scrollTop = viewport.current.scrollHeight }

  return <main className="wb-page chat-page">
    <h1 className="chat-sr-only">Messages</h1>
    {opening && <Notice>Opening your conversation...</Notice>}
    {openError && <Notice kind="error">{openError} <button className="wb-button wb-button-link" type="button" onClick={() => setOpenRevision(current => current + 1)}>Try again</button> <Link to="/chat" className="social-text-link">Dismiss</Link></Notice>}
    <div className={`chat-layout${conversationId ? ' chat-has-selection' : ''}`}>
      <aside className="chat-sidebar" aria-label="Conversations">
        <div className="chat-sidebar-heading"><div><h2>Inbox</h2><span>Private conversations</span></div><div className="chat-sidebar-actions"><button className="chat-icon-button chat-new-conversation" type="button" aria-label="New conversation" title="New conversation" onClick={() => setNewOpen(true)}><ChatIcon name="plus" /></button><button className="chat-icon-button" type="button" aria-label="Refresh conversations and messages" title="Refresh" onClick={chat.refresh} disabled={chat.listLoading}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M18 17a7 7 0 0 1-12 1l-2-3" /></svg></button></div></div>
        <label className="chat-search"><ChatIcon name="search" /><input aria-label="Search conversations" type="search" placeholder="Search conversations" value={search} onChange={event => setSearch(event.target.value)} /></label>
        <div className="chat-conversation-list" aria-busy={chat.listLoading}>
          {chat.listError && <Notice kind="error">{chat.listError}<button className="wb-button wb-button-link" type="button" onClick={() => void chat.loadConversations()}>Try again</button></Notice>}
          {filtered.map(item => {
            const name = conversationLabel(item, user!.id)
            return <Link key={item.id} to={`/chat/${item.id}`} className={`chat-conversation${item.id === conversationId ? ' selected' : ''}`} aria-current={item.id === conversationId ? 'page' : undefined}>
              <Avatar id={item.other_participant?.avatar_media_id ?? null} name={item.other_participant?.username ?? 'User'} className="chat-avatar" />
              <span className="chat-conversation-copy"><span className="chat-conversation-top"><strong>{name}</strong>{item.last_message && <time dateTime={item.last_message.created_at}>{dayKey(item.last_message.created_at) === dayKey(new Date().toISOString()) ? clock(item.last_message.created_at) : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(item.last_message.created_at))}</time>}</span>
                <span className="chat-preview">{item.last_message ? `${item.last_message.sender_id === user!.id ? 'You: ' : ''}${messagePreview(item.last_message)}` : 'Start the conversation'}</span>
              </span>
            </Link>
          })}
          {chat.listLoading && <p className="chat-list-hint" role="status">Loading conversations...</p>}
          {!chat.listLoading && !chat.listError && filtered.length === 0 && <div className="chat-list-empty"><ChatIcon name="bubble" /><strong>{search ? 'No conversations found' : 'A little quiet here'}</strong><p>{search ? 'Try another username or load more conversations.' : 'Pick a friend to start your first conversation.'}</p>{!search && <button type="button" className="wb-button" onClick={() => setNewOpen(true)}>Message a friend</button>}</div>}
          {chat.hasMore && <button className="wb-button chat-load-more" type="button" disabled={chat.listLoading} onClick={() => void chat.loadConversations(true)}>Load more conversations</button>}
        </div>
        <div className={`chat-connection chat-connection-${chat.connectionState}`} role="status"><span aria-hidden="true" />{stateLabel[chat.connectionState]}{chat.connectionState !== 'connected' && <button type="button" onClick={chat.reconnect} disabled={chat.connectionState === 'offline'}>Reconnect</button>}</div>
      </aside>

      <section className="chat-thread" aria-label={conversationId ? `Messages with ${label}` : 'Select a conversation'}>
        {!conversationId ? <div className="chat-welcome"><div className="chat-welcome-art" aria-hidden="true"><ChatIcon name="bubble" /><span className="chat-court-line" /></div><span className="wb-kicker">BETTER TOGETHER</span><h2>Keep the conversation going.</h2><p>Talk basketball, plan your next practice or simply catch up with a friend.</p><button className="wb-button wb-button-primary" type="button" onClick={() => setNewOpen(true)}><ChatIcon name="plus" />Message a friend</button><small>Only friends can send each other messages.</small></div> : <>
          <header className="chat-thread-heading"><Link className="chat-icon-button chat-back" to="/chat" aria-label="Back to conversations"><ChatIcon name="back" /></Link><Avatar id={chat.selected?.other_participant?.avatar_media_id ?? null} name={chat.selected?.other_participant?.username ?? 'User'} className="chat-avatar" /><div><h2>{label}</h2><p>{chat.selected?.other_participant ? publicRoleLabel[chat.selected.other_participant.role] : 'Private conversation'}</p></div><span className="chat-private-label"><ChatIcon name="bubble" />Private chat</span></header>
          {chat.connectionError && <div className="chat-thread-notice" role="status">{chat.connectionError}</div>}
          {chat.access === 'blocked' && <div className="chat-thread-notice" role="status">You can only message current friends. Your conversation history is still available.</div>}
          {chat.access === 'unavailable' && <div className="chat-thread-notice" role="status">Could not verify your friendship. {chat.accessError} <button type="button" className="wb-button wb-button-link" onClick={chat.refresh}>Try again</button></div>}
          <div className="chat-messages" ref={viewport} tabIndex={0} role="log" aria-label="Conversation history" aria-live="polite" aria-relevant="additions" onScroll={() => {
            const element = viewport.current
            if (!element) return
            nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100
            setShowLatest(!nearBottom.current)
          }}>
            {!validId && <Notice kind="error">This conversation link is invalid. Choose a conversation from your inbox.</Notice>}
            {chat.history.error && <Notice kind="error">{chat.history.error}<button type="button" className="wb-button wb-button-link" onClick={() => void chat.loadHistory(conversationId)}>Try again</button></Notice>}
            {chat.history.cursor && <button type="button" className="wb-button chat-older" disabled={chat.history.loading} onClick={older}>Load earlier messages</button>}
            {chat.history.loading && <p className="chat-list-hint" role="status">Loading messages...</p>}
            {validId && chat.history.loaded && !rows.length && <div className="chat-start-note"><ChatIcon name="bubble" /><strong>A fresh conversation</strong><span>Say hello to {label}.</span></div>}
            {rows.map((row, index) => <div key={row.key}>
              {(index === 0 || dayKey(rows[index - 1]!.date) !== dayKey(row.date)) && <div className="chat-date-divider"><span>{dayLabel(row.date)}</span></div>}
              <article className={`chat-message${row.own ? ' chat-message-own' : ''}${row.pending?.state === 'failed' ? ' chat-message-failed' : ''}`} aria-label={`${row.own ? 'You' : label}, ${clock(row.date)}`}>
                <div className="chat-bubble">{row.message && row.message.type !== 'TEXT' && <ChatMedia message={row.message} onLoad={mediaLoaded} />}{row.pending?.file && <LocalChatMedia file={row.pending.file} onLoad={mediaLoaded} />}{row.text && <p>{row.text}</p>}<footer><time dateTime={row.date}>{clock(row.date)}</time>{row.own && <span>{row.pending ? row.pending.state === 'sending' ? row.pending.type === 'TEXT' ? 'Sending...' : 'Uploading...' : 'Not confirmed' : 'Saved'}</span>}</footer></div>
                {row.pending?.state === 'failed' && <div className="chat-send-error"><span>{row.pending.error}</span><button type="button" disabled={!sendEnabled} onClick={() => { if (row.pending) chat.retry(row.pending) }}>Retry</button></div>}
              </article>
            </div>)}
          </div>
          {showLatest && <button className="wb-button chat-jump" type="button" onClick={() => { if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; nearBottom.current = true; setShowLatest(false) }}>Jump to latest ↓</button>}
          <form className="chat-composer" onSubmit={submit}>
            {(attachmentError || chat.mediaConfigError) && <div className="chat-attachment-error" role="alert">{attachmentError || `Attachments unavailable: ${chat.mediaConfigError}`}<button type="button" className="wb-button wb-button-link" onClick={() => { setAttachmentError(null); chat.refresh() }}>Try again</button></div>}
            {selectedFile && <div className="chat-attachment-preview"><LocalChatMedia file={selectedFile} /><div><strong>{selectedFile.name}</strong><small>{(selectedFile.size / 1024 / 1024).toFixed(1)} MB · Add an optional comment below</small></div><button type="button" className="chat-icon-button" aria-label="Remove attachment" onClick={() => { setAttachment(null); setAttachmentError(null) }}>×</button></div>}
            <input ref={fileInput} className="chat-sr-only" tabIndex={-1} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" aria-label="Select a chat attachment" onChange={event => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (!file || !conversationId || !chat.mediaConfig) return
              try { attachmentType(file, chat.mediaConfig); setAttachment({ conversationId, file }); setAttachmentError(null) }
              catch (error) { setAttachmentError(errorText(error)) }
            }} />
            <label className="chat-sr-only" htmlFor="chat-message">Message to {label}</label>
            <div className="chat-composer-input"><button className="chat-icon-button chat-attach" type="button" aria-label="Attach an image or video" title="Attach an image or video" disabled={!sendEnabled || !chat.mediaConfig} onClick={() => fileInput.current?.click()}><ChatIcon name="attach" /></button><textarea ref={composer} id="chat-message" rows={2} placeholder={chat.access === 'blocked' ? 'Messaging is available between friends only' : selectedFile ? 'Add a comment (optional)...' : 'Write a message...'} value={draft} maxLength={4000} disabled={!sendEnabled} onKeyDown={composerKey} onChange={event => { if (conversationId) setDrafts(current => ({ ...current, [conversationId]: event.target.value })) }} />
              <button type="submit" className="chat-send" disabled={!sendEnabled || (!draft.trim() && !selectedFile)} aria-label="Send message"><ChatIcon name="send" /><span>Send</span></button></div>
            <div className="chat-composer-hint"><span>{chat.access === 'checking' ? 'Checking your connection...' : 'Enter to send · Shift + Enter for a new line'}</span><span>{draft.length.toLocaleString('en-GB')} / 4,000</span></div>
          </form>
        </>}
      </section>
    </div>
    {newOpen && <NewConversation onClose={() => setNewOpen(false)} start={start} />}
  </main>
}
