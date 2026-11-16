import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { ChatConnection } from '../services/chat-connection'
import { chatSocketUrl, mergeMessages, sortConversations } from '../services/chat'
import { errorText } from '../services/format'
import type { ApiRequestOptions } from '../services/api'
import type { ChatEvent, ChatMessage, ChatTicket, ConnectionState, Conversation, ConversationPage, MessagePage, OutgoingMessage, SendMessage } from '../types/chat'
import type { PublicProfile } from '../types/social'

interface History {
  items: ChatMessage[]
  latestLoadedId: string | null
  cursor: string | null
  loaded: boolean
  loading: boolean
  error: string | null
}

const emptyHistory: History = { items: [], latestLoadedId: null, cursor: null, loaded: false, loading: false, error: null }

export function useChat(selectedId: string | undefined) {
  const { request, user } = useAuth()
  const userId = user!.id
  const communication = useCallback(<T,>(path: string, options: Omit<ApiRequestOptions, 'token'> = {}) =>
    request<T>(path, { ...options, service: 'communication' }), [request])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const offset = useRef(0)
  const listController = useRef<AbortController | null>(null)
  const [histories, setHistories] = useState<Record<string, History>>({})
  const historiesRef = useRef(histories)
  const [outgoing, setOutgoing] = useState<Record<string, OutgoingMessage>>({})
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting')
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [access, setAccess] = useState<'checking' | 'allowed' | 'blocked' | 'unavailable'>('checking')
  const [accessError, setAccessError] = useState<string | null>(null)
  const [accessRevision, setAccessRevision] = useState(0)
  const connection = useRef<ChatConnection | null>(null)
  const pending = useRef(new Map<string, OutgoingMessage>())
  const ackTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const historyControllers = useRef(new Map<string, AbortController>())
  const mounted = useRef(false)
  const events = useRef<(event: ChatEvent) => void>(() => {})
  const listRef = useRef(conversations)
  const selectedRef = useRef(selectedId)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const loadConversations = useCallback(async (more = false) => {
    if (more && listController.current && !listController.current.signal.aborted) return
    listController.current?.abort()
    const controller = new AbortController()
    listController.current = controller
    const start = more ? offset.current : 0
    setListLoading(true); setListError(null)
    try {
      const result = await communication<ConversationPage>(`/conversations?limit=100&offset=${start}`, { signal: controller.signal })
      if (controller.signal.aborted || !mounted.current) return
      offset.current = start + result.items.length
      setHasMore(result.items.length === 100 && offset.current <= 10000)
      setConversations(current => {
        const byId = new Map((more ? current : []).map(item => [item.id, item]))
        for (const item of result.items) {
          // Keep newer live updates that arrived while this snapshot was loading.
          const live = current.find(existing => existing.id === item.id)?.last_message
          byId.set(item.id, live && live.created_at > (item.last_message?.created_at ?? '') ? { ...item, last_message: live } : item)
        }
        return sortConversations([...byId.values()])
      })
    } catch (error) {
      if (!controller.signal.aborted && mounted.current) setListError(errorText(error))
    } finally {
      if (!controller.signal.aborted && mounted.current) { listController.current = null; setListLoading(false) }
    }
  }, [communication])

  const loadHistory = useCallback(async (id: string, before?: string) => {
    historyControllers.current.get(id)?.abort()
    const controller = new AbortController()
    historyControllers.current.set(id, controller)
    setHistories(current => ({ ...current, [id]: { ...(current[id] ?? emptyHistory), loading: true, error: null } }))
    try {
      const fetchPage = (cursor?: string) => communication<MessagePage>(`/conversations/${id}/messages?limit=50${cursor ? `&before=${encodeURIComponent(cursor)}` : ''}`, { signal: controller.signal })
      const page = await fetchPage(before)
      const latestLoadedId = page.items.at(-1)?.id ?? null
      const anchorId = before ? null : historiesRef.current[id]?.latestLoadedId
      // Reconnects can miss more than one page: fetch until the last known snapshot,
      // rather than silently leaving a gap between old history and the latest page.
      while (anchorId && page.next_cursor && !page.items.some(message => message.id === anchorId)) {
        const earlier = await fetchPage(page.next_cursor)
        page.items = mergeMessages(earlier.items, page.items)
        page.next_cursor = earlier.next_cursor
      }
      if (controller.signal.aborted || !mounted.current) return
      setHistories(current => {
        const history = current[id] ?? emptyHistory
        return { ...current, [id]: {
          items: mergeMessages(history.items, page.items),
          latestLoadedId: before ? history.latestLoadedId : latestLoadedId,
          cursor: before || !history.loaded ? page.next_cursor : history.cursor,
          loaded: true, loading: false, error: null,
        } }
      })
      // Reconcile lost ACKs from saved history, even after a reconnect.
      for (const message of page.items) {
        if (message.sender_id === userId && pending.current.get(message.client_message_id)?.conversation_id === id) {
          pending.current.delete(message.client_message_id)
          clearTimeout(ackTimers.current.get(message.client_message_id))
          ackTimers.current.delete(message.client_message_id)
          setOutgoing(current => { const next = { ...current }; delete next[message.client_message_id]; return next })
        }
      }
    } catch (error) {
      if (!controller.signal.aborted && mounted.current) setHistories(current => ({ ...current, [id]: { ...(current[id] ?? emptyHistory), loading: false, error: errorText(error) } }))
    } finally {
      if (historyControllers.current.get(id) === controller) historyControllers.current.delete(id)
    }
  }, [communication, userId])

  const fail = useCallback((id: string, reason: string) => {
    const item = pending.current.get(id)
    if (!item) return
    const failed: OutgoingMessage = { ...item, state: 'failed', error: reason }
    pending.current.set(id, failed)
    clearTimeout(ackTimers.current.get(id)); ackTimers.current.delete(id)
    if (mounted.current) setOutgoing(current => ({ ...current, [id]: failed }))
  }, [])

  const failPending = useCallback(() => {
    for (const [id, item] of pending.current) if (item.state === 'sending') fail(id, 'Confirmation not received. Retry to check whether this message was saved.')
  }, [fail])

  const acceptMessage = useCallback((message: ChatMessage) => {
    if (message.sender_id === userId) {
      pending.current.delete(message.client_message_id)
      clearTimeout(ackTimers.current.get(message.client_message_id)); ackTimers.current.delete(message.client_message_id)
      setOutgoing(current => { const next = { ...current }; delete next[message.client_message_id]; return next })
    }
    setHistories(current => ({ ...current, [message.conversation_id]: {
      ...(current[message.conversation_id] ?? emptyHistory),
      items: mergeMessages(current[message.conversation_id]?.items ?? [], [message]),
    } }))
    if (!listRef.current.some(item => item.id === message.conversation_id)) {
      clearTimeout(refreshTimer.current)
      refreshTimer.current = setTimeout(() => { void loadConversations() }, 250)
    }
    setConversations(current => sortConversations(current.map(item => item.id === message.conversation_id &&
      (!item.last_message || message.created_at > item.last_message.created_at ||
        (message.created_at === item.last_message.created_at && message.id > item.last_message.id))
      ? { ...item, last_message: message } : item)))
  }, [userId, loadConversations])

  useEffect(() => { listRef.current = conversations; selectedRef.current = selectedId; historiesRef.current = histories }, [conversations, selectedId, histories])

  useEffect(() => {
    events.current = event => {
      if (event.event === 'ready') {
        void loadConversations()
        if (selectedRef.current) void loadHistory(selectedRef.current)
        setAccessRevision(current => current + 1)
      } else if (event.event === 'message.received' || event.event === 'message.ack') {
        acceptMessage(event.message)
      } else if (event.event === 'error') {
        if (event.client_message_id) {
          const item = pending.current.get(event.client_message_id)
          if (item?.conversation_id === selectedRef.current && ['NOT_FRIENDS', 'USER_NOT_FOUND'].includes(event.code)) setAccess('blocked')
          fail(event.client_message_id, event.message)
        } else setConnectionError(event.message)
      }
    }
  }, [acceptMessage, fail, loadConversations, loadHistory])

  useEffect(() => {
    mounted.current = true
    const live = new ChatConnection({
      url: chatSocketUrl(), userId,
      getTicket: signal => communication<ChatTicket>('/ws/tickets', { method: 'POST', signal }),
      onEvent: event => { if (mounted.current) events.current(event) },
      onState: (state, error) => { if (mounted.current) { setConnectionState(state); setConnectionError(error) } },
      onDisconnect: failPending,
    })
    connection.current = live
    const online = () => { live.reconnect(); void loadConversations(); setAccessRevision(current => current + 1) }
    const offline = () => { live.stop(); failPending(); setConnectionState('offline'); setConnectionError('You are offline. Chat will reconnect when your connection returns.') }
    const focus = () => {
      void loadConversations()
      if (selectedRef.current) void loadHistory(selectedRef.current)
      setAccessRevision(current => current + 1)
    }
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    window.addEventListener('focus', focus)
    void loadConversations()
    if (navigator.onLine) live.start(); else offline()
    return () => {
      mounted.current = false
      live.stop(); connection.current = null
      listController.current?.abort()
      for (const controller of historyControllers.current.values()) controller.abort()
      for (const timer of ackTimers.current.values()) clearTimeout(timer)
      ackTimers.current.clear()
      clearTimeout(refreshTimer.current)
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
      window.removeEventListener('focus', focus)
    }
  }, [communication, userId, failPending, loadConversations, loadHistory])

  useEffect(() => {
    if (selectedId && /^[a-f0-9]{24}$/i.test(selectedId)) void loadHistory(selectedId)
    return () => { if (selectedId) historyControllers.current.get(selectedId)?.abort() }
  }, [selectedId, loadHistory])

  const selected = conversations.find(item => item.id === selectedId)
  const otherId = selected?.participant_ids.find(id => id !== userId)
  useEffect(() => {
    if (selectedId && !selected && hasMore && !listLoading && !listError) void loadConversations(true)
  }, [selectedId, selected, hasMore, listLoading, listError, loadConversations])

  useEffect(() => {
    setAccess('checking'); setAccessError(null)
    if (!otherId) return
    const controller = new AbortController()
    request<PublicProfile>(`/users/${otherId}/public`, { signal: controller.signal }).then(profile => {
      if (!controller.signal.aborted) setAccess(profile.friendship_status === 'FRIENDS' ? 'allowed' : 'blocked')
    }).catch(error => {
      if (!controller.signal.aborted) { setAccess('unavailable'); setAccessError(errorText(error)) }
    })
    return () => controller.abort()
  }, [otherId, request, accessRevision])

  const send = useCallback((item: OutgoingMessage) => {
    if (connectionState !== 'connected' || access !== 'allowed' || item.conversation_id !== selectedId) return false
    const sending: OutgoingMessage = { ...item, state: 'sending', error: null }
    pending.current.set(item.client_message_id, sending)
    setOutgoing(current => ({ ...current, [item.client_message_id]: sending }))
    const frame: SendMessage = {
      event: 'message.send', conversation_id: item.conversation_id,
      client_message_id: item.client_message_id, type: 'TEXT', text: item.text,
    }
    clearTimeout(ackTimers.current.get(item.client_message_id))
    if (!connection.current?.send(frame)) { fail(item.client_message_id, 'Chat is disconnected. Reconnect and retry.'); return true }
    ackTimers.current.set(item.client_message_id, setTimeout(() => fail(item.client_message_id, 'Confirmation not received. Retry using the same message.'), 12000))
    return true
  }, [connectionState, access, selectedId, fail])

  const sendText = (text: string) => {
    if (!selectedId || !text.trim() || text.trim().length > 4000) return false
    return send({
      event: 'message.send', conversation_id: selectedId, client_message_id: crypto.randomUUID(),
      type: 'TEXT', text: text.trim(), created_at: new Date().toISOString(), state: 'sending', error: null,
    })
  }

  const startConversation = useCallback(async (friendId: number, signal?: AbortSignal) => {
    const result = await communication<Conversation>('/conversations', { method: 'POST', body: { user_id: friendId }, signal })
    if (mounted.current && !signal?.aborted) setConversations(current => sortConversations([result, ...current.filter(item => item.id !== result.id)]))
    return result
  }, [communication])

  return {
    conversations, selected, listLoading, listError, hasMore, loadConversations,
    history: selectedId ? histories[selectedId] ?? emptyHistory : emptyHistory,
    loadHistory, outgoing: Object.values(outgoing).filter(item => item.conversation_id === selectedId),
    connectionState, connectionError, access, accessError,
    reconnect: () => { failPending(); connection.current?.reconnect(); setAccessRevision(current => current + 1) },
    refresh: () => { void loadConversations(); if (selectedId) void loadHistory(selectedId); setAccessRevision(current => current + 1) },
    startConversation, sendText, retry: send,
  }
}
