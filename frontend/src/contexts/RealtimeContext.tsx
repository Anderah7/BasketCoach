import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router'
import { ChatConnection } from '../services/chat-connection'
import { chatSocketUrl } from '../services/chat'
import type { ChatEvent, ChatTicket, ClientChatEvent, ConnectionState } from '../types/chat'
import { useAuth } from './AuthContext'

interface RealtimeContextValue {
  state: ConnectionState
  error: string | null
  send: (event: ClientChatEvent) => boolean
  subscribe: (listener: (event: ChatEvent) => void) => () => void
  reconnect: () => void
}
const Context = createContext<RealtimeContextValue | null>(null)

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { request, user } = useAuth()
  const userId = user!.id
  const { pathname } = useLocation()
  const [state, setState] = useState<ConnectionState>('connecting')
  const [error, setError] = useState<string | null>(null)
  const connection = useRef<ChatConnection | null>(null)
  const listeners = useRef(new Set<(event: ChatEvent) => void>())
  const currentView = useRef<string | null>(null)
  const publishView = useCallback(() => {
    connection.current?.send({ event: 'conversation.view', conversation_id:
      document.visibilityState === 'visible' && document.hasFocus() ? currentView.current : null })
  }, [])
  useEffect(() => {
    currentView.current = pathname.match(/^\/chat\/([a-f0-9]{24})\/?$/i)?.[1] ?? null
    publishView()
  }, [pathname, publishView])
  useEffect(() => {
    const live = new ChatConnection({
      url: chatSocketUrl(), userId,
      getTicket: signal => request<ChatTicket>('/ws/tickets', { method: 'POST', service: 'communication', signal }),
      onState: (value, message) => { setState(value); setError(message) },
      onDisconnect: () => {},
      onEvent: event => {
        if (event.event === 'ready') publishView()
        if (event.event === 'error' && event.client_message_id === null) setError(event.message)
        for (const listener of listeners.current) listener(event)
      },
    })
    connection.current = live
    const online = () => live.reconnect()
    const offline = () => { live.stop(); setState('offline'); setError('You are offline. Reconnecting when your connection returns.') }
    window.addEventListener('online', online); window.addEventListener('offline', offline)
    window.addEventListener('focus', publishView); window.addEventListener('blur', publishView)
    document.addEventListener('visibilitychange', publishView)
    if (navigator.onLine) live.start(); else offline()
    return () => {
      live.stop(); connection.current = null
      window.removeEventListener('online', online); window.removeEventListener('offline', offline)
      window.removeEventListener('focus', publishView); window.removeEventListener('blur', publishView)
      document.removeEventListener('visibilitychange', publishView)
    }
  }, [request, userId, publishView])
  const send = useCallback((event: ClientChatEvent) => connection.current?.send(event) ?? false, [])
  const subscribe = useCallback((listener: (event: ChatEvent) => void) => {
    listeners.current.add(listener)
    return () => { listeners.current.delete(listener) }
  }, [])
  const reconnect = useCallback(() => { if (navigator.onLine) connection.current?.reconnect() }, [])
  return <Context.Provider value={{ state, error, send, subscribe, reconnect }}>{children}</Context.Provider>
}

export function useRealtime() {
  const value = useContext(Context)
  if (!value) throw new Error('useRealtime requires RealtimeProvider')
  return value
}
