import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router'
import { ApiError } from '../services/api'
import { errorText } from '../services/format'
import type { Friend, FriendRequest, FriendRequestsResponse, FriendshipAction, Relationship } from '../types/social'
import { useAuth } from './AuthContext'
import { useRealtime } from './RealtimeContext'

interface FriendsData {
  friends: Friend[]
  requests: FriendRequestsResponse
}

interface Feedback {
  kind: 'success' | 'error'
  message: string
}

interface FriendsContextValue {
  data: FriendsData | null
  loading: boolean
  error: string | null
  feedback: Feedback | null
  busy: FriendshipAction | null
  refresh: () => Promise<void>
  perform: (action: FriendshipAction) => Promise<boolean>
  relationship: (userId: number) => Relationship
  selectedProfileId: number | null
  openProfile: (userId: number) => void
  closeProfile: () => void
}

const FriendsContext = createContext<FriendsContextValue | null>(null)

export function FriendsProvider({ children }: { children: ReactNode }) {
  const { request, user } = useAuth()
  const { subscribe } = useRealtime()
  const { pathname } = useLocation()
  const [data, setData] = useState<FriendsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [busy, setBusy] = useState<FriendshipAction | null>(null)
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(null)
  const controller = useRef<AbortController | null>(null)
  const actionLock = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; controller.current?.abort() }
  }, [])

  const refresh = useCallback(async () => {
    controller.current?.abort()
    const current = new AbortController()
    controller.current = current
    setLoading(true); setError(null)
    try {
      const [friends, requests] = await Promise.all([
        request<Friend[]>('/friends', { signal: current.signal }),
        request<FriendRequestsResponse>('/friends/requests', { signal: current.signal }),
      ])
      if (!current.signal.aborted && mounted.current) setData({ friends, requests })
    } catch (cause) {
      if (!current.signal.aborted && mounted.current) setError(errorText(cause))
    } finally {
      if (!current.signal.aborted && mounted.current) setLoading(false)
    }
  }, [request])

  useEffect(() => {
    setFeedback(null); setSelectedProfileId(null)
    void refresh()
    return () => controller.current?.abort()
  }, [pathname, refresh])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = subscribe(event => {
      if (event.event === 'ready' || (event.event === 'notification.created' && event.notification.type !== 'NEW_MESSAGE')) {
        clearTimeout(timer)
        timer = setTimeout(() => { void refresh() }, 100)
      }
    })
    return () => { clearTimeout(timer); unsubscribe() }
  }, [subscribe, refresh])

  function relationship(userId: number): Relationship {
    if (userId === user?.id) return { status: 'SELF', requestId: null }
    if (data?.friends.some((friend) => friend.id === userId)) return { status: 'FRIENDS', requestId: null }
    const received = data?.requests.received.find((item) => item.sender.id === userId && item.status === 'PENDING')
    if (received) return { status: 'PENDING_RECEIVED', requestId: received.id }
    const sent = data?.requests.sent.find((item) => item.recipient.id === userId && item.status === 'PENDING')
    return sent ? { status: 'PENDING_SENT', requestId: sent.id } : { status: 'NONE', requestId: null }
  }

  function openProfile(userId: number) {
    setFeedback(null)
    setSelectedProfileId(userId)
  }

  async function perform(action: FriendshipAction): Promise<boolean> {
    if (actionLock.current) return false
    actionLock.current = true
    setBusy(action); setFeedback(null)
    try {
      if (action.type === 'remove') {
        await request<void>(`/friends/${action.userId}`, { method: 'DELETE' })
        if (mounted.current) setData((current) => current ? { ...current, friends: current.friends.filter((friend) => friend.id !== action.userId) } : current)
      } else {
        const result = action.type === 'send'
          ? await request<FriendRequest>('/friends/requests', { method: 'POST', body: { user_id: action.userId } })
          : await request<FriendRequest>(`/friends/requests/${action.requestId}/${action.type}`, { method: 'POST' })
        if (mounted.current) setData((current) => {
          if (!current) return current
          const key = result.sender.id === user?.id ? 'sent' : 'received'
          const counterpart = result.sender.id === user?.id ? result.recipient : result.sender
          return {
            friends: action.type === 'accept'
              ? [...current.friends.filter((friend) => friend.id !== counterpart.id), { ...counterpart, friends_since: result.responded_at ?? result.created_at }]
              : current.friends,
            requests: { ...current.requests, [key]: [result, ...current.requests[key].filter((item) => item.id !== result.id)] },
          }
        })
      }
      if (mounted.current) {
        const messages = { send: 'Friend request sent.', accept: 'Friend request accepted.', reject: 'Friend request rejected.', remove: 'Friend removed.' }
        setFeedback({ kind: 'success', message: messages[action.type] })
        await refresh()
      }
      return true
    } catch (cause) {
      if (mounted.current) {
        setFeedback({ kind: 'error', message: errorText(cause) })
        if (cause instanceof ApiError && (cause.status === 409 || cause.status === 404)) await refresh()
      }
      return false
    } finally {
      actionLock.current = false
      if (mounted.current) setBusy(null)
    }
  }

  return <FriendsContext.Provider value={{
    data, loading, error, feedback, busy, refresh, perform, relationship,
    selectedProfileId, openProfile, closeProfile: () => setSelectedProfileId(null),
  }}>{children}</FriendsContext.Provider>
}

export function useFriends(): FriendsContextValue {
  const context = useContext(FriendsContext)
  if (!context) throw new Error('useFriends must be used inside FriendsProvider')
  return context
}
