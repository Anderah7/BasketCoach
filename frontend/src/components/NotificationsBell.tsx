import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useNotifications } from '../contexts/NotificationsContext'
import { useRealtime } from '../contexts/RealtimeContext'
import { notificationPath, notificationText } from '../services/notifications'
import { formatDateTime } from '../services/format'
import type { Notification } from '../types/notifications'
import { Avatar } from './ProtectedMedia'
import './notifications.css'

export function NotificationsBell() {
  const notifications = useNotifications()
  const realtime = useRealtime()
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  async function visit(item: Notification) {
    if (!item.is_read) await notifications.read(item.id)
    setOpen(false); navigate(notificationPath(item))
  }
  return <div className="notifications-control" ref={container}>
    <button type="button" className="notification-trigger" aria-label={`Notifications, ${notifications.unread} unread`} aria-expanded={open} aria-controls="notification-popover" onClick={() => { if (!open) void notifications.refresh(); setOpen(value => !value) }}>
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4M12 2V1" /></svg>
      {notifications.unread > 0 && <span className="notification-badge">{notifications.unread > 99 ? '99+' : notifications.unread}</span>}
    </button>
    {open && <section className="notification-popover" id="notification-popover" aria-label="Notifications">
      <header><div><h2>Notifications</h2><span>{notifications.unread} unread</span></div><button className="wb-button wb-button-link" type="button" disabled={notifications.busy || notifications.unread === 0} onClick={() => void notifications.readAll()}>Mark all as read</button></header>
      {realtime.state !== 'connected' && <div className="notification-status">{realtime.state === 'offline' ? 'Offline. Saved notifications remain available.' : realtime.state === 'error' ? 'Live updates are unavailable.' : 'Live updates reconnecting…'}<button type="button" onClick={realtime.reconnect}>Reconnect</button></div>}
      {notifications.error && <div className="notification-status notification-error" role="alert">{notifications.error}<button type="button" onClick={() => void notifications.refresh()}>Try again</button></div>}
      <div className="notification-list" aria-busy={notifications.loading}>
        {notifications.items.map(item => <article key={item.id} className={`notification-item${item.is_read ? '' : ' notification-unread'}`}>
          <button className="notification-open" type="button" disabled={notifications.busy} onClick={() => void visit(item)}>
            <Avatar id={item.actor?.avatar_media_id ?? null} name={item.actor?.username ?? 'User'} className="notification-avatar" />
            <span><strong>{notificationText(item)}</strong><time dateTime={item.created_at}>{formatDateTime(item.created_at)}</time></span>
          </button>
          {!item.is_read && <button className="notification-read" type="button" disabled={notifications.busy} aria-label={`Mark notification from ${item.actor?.username ?? `user ${item.actor_id}`} as read`} title="Mark as read" onClick={() => void notifications.read(item.id)}>✓</button>}
        </article>)}
        {notifications.loading && <p className="notification-empty" role="status">Loading notifications...</p>}
        {!notifications.loading && !notifications.items.length && !notifications.error && <p className="notification-empty">You're all caught up. New activity will appear here.</p>}
        {notifications.hasMore && <button type="button" className="wb-button notification-more" disabled={notifications.loading} onClick={() => void notifications.more()}>Load more</button>}
      </div>
    </section>}
  </div>
}
