import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Notification, NotificationPage } from '../types/notifications'
import { errorText } from '../services/format'
import { useAuth } from './AuthContext'
import { useRealtime } from './RealtimeContext'

interface Value {
  items: Notification[]; unread: number; loading: boolean; hasMore: boolean; error: string | null; busy: boolean
  refresh: () => Promise<void>; more: () => Promise<void>; read: (id: string) => Promise<void>; readAll: () => Promise<void>
}
const Context = createContext<Value | null>(null)

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { request } = useAuth()
  const { subscribe } = useRealtime()
  const [items, setItems] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const countLoaded = useRef(0)
  const active = useRef(true)
  const controller = useRef<AbortController | null>(null)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const load = useCallback(async (more = false) => {
    controller.current?.abort()
    const current = new AbortController(); controller.current = current
    setLoading(true); setError(null)
    try {
      const offset = more ? countLoaded.current : 0
      const [page, total] = await Promise.all([
        request<NotificationPage>(`/notifications?limit=20&offset=${offset}`, { service: 'communication', signal: current.signal }),
        request<{ unread_count: number }>('/notifications/unread-count', { service: 'communication', signal: current.signal }),
      ])
      if (current.signal.aborted || !active.current) return
      countLoaded.current = offset + page.items.length
      setItems(previous => {
        const byId = new Map((more ? previous : []).map(item => [item.id, item]))
        for (const item of page.items) byId.set(item.id, item)
        return [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
      })
      setUnread(total.unread_count); setHasMore(page.has_more)
    } catch (cause) { if (!current.signal.aborted && active.current) setError(errorText(cause)) }
    finally { if (!current.signal.aborted && active.current) setLoading(false) }
  }, [request])
  const refresh = useCallback(() => load(), [load])
  useEffect(() => {
    active.current = true
    void refresh()
    const unsubscribe = subscribe(event => {
      if (event.event !== 'ready' && event.event !== 'notification.created' && event.event !== 'notifications.read') return
      if (event.event === 'notification.created') {
        setUnread(event.unread_count)
        setItems(previous => [event.notification, ...previous.filter(item => item.id !== event.notification.id)]
          .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)))
      } else if (event.event === 'notifications.read') {
        setUnread(event.unread_count)
        setItems(previous => previous.map(item => event.all || event.notification_id === item.id ||
          (event.conversation_id && item.type === 'NEW_MESSAGE' && item.resource.conversation_id === event.conversation_id)
          ? { ...item, is_read: true, read_at: item.read_at ?? event.read_at } : item))
      }
      controller.current?.abort()
      clearTimeout(refreshTimer.current)
      refreshTimer.current = setTimeout(() => { void refresh() }, event.event === 'ready' ? 0 : 100)
    })
    return () => { active.current = false; controller.current?.abort(); clearTimeout(refreshTimer.current); unsubscribe() }
  }, [refresh, subscribe])
  async function change(path: string) {
    if (busy) return
    setBusy(true); setError(null)
    try { await request(path, { method: 'PATCH', service: 'communication' }); if (active.current) await refresh() }
    catch (cause) { if (active.current) setError(errorText(cause)) }
    finally { if (active.current) setBusy(false) }
  }
  return <Context.Provider value={{ items, unread, loading, hasMore, error, busy, refresh, more: () => load(true),
    read: id => change(`/notifications/${id}/read`), readAll: () => change('/notifications/read-all') }}>{children}</Context.Provider>
}

export function useNotifications() {
  const value = useContext(Context)
  if (!value) throw new Error('useNotifications requires NotificationsProvider')
  return value
}
