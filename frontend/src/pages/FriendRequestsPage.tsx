import { useState } from 'react'
import { FriendshipControls } from '../components/FriendshipControls'
import { PublicUserCard } from '../components/PublicUserCard'
import { EmptyState, Notice } from '../components/WorkspaceUI'
import { useFriends } from '../contexts/FriendsContext'
import { formatDateTime } from '../services/format'
import type { FriendRequestStatus } from '../types/social'

const requestLabel: Record<FriendRequestStatus, string> = { PENDING: 'Pending', ACCEPTED: 'Accepted', REJECTED: 'Rejected' }
const requestClass: Record<FriendRequestStatus, string> = { PENDING: 'PENDING', ACCEPTED: 'COMPLETED', REJECTED: 'CANCELLED' }

export function FriendRequestsPage() {
  const { data, loading } = useFriends()
  const [direction, setDirection] = useState<'received' | 'sent'>('received')
  const [showAnswered, setShowAnswered] = useState(false)
  if (!data) return loading ? <Notice>Loading friend requests...</Notice> : null
  const items = data.requests[direction].filter((item) => showAnswered || item.status === 'PENDING')
  const receivedCount = data.requests.received.filter((item) => item.status === 'PENDING').length
  const sentCount = data.requests.sent.filter((item) => item.status === 'PENDING').length

  return <section className="wb-card" aria-busy={loading}>
    <div className="wb-card-heading"><div><h2>Friend requests</h2><p>Answer incoming requests and check the ones you have sent.</p></div></div>
    <div className="wb-collection-switch" role="group" aria-label="Request direction">
      <button type="button" aria-pressed={direction === 'received'} onClick={() => setDirection('received')}>Received <span>{receivedCount}</span></button>
      <button type="button" aria-pressed={direction === 'sent'} onClick={() => setDirection('sent')}>Sent <span>{sentCount}</span></button>
    </div>
    <label className="wb-checkbox social-history-toggle"><input type="checkbox" checked={showAnswered} onChange={(event) => setShowAnswered(event.target.checked)} />Show answered requests</label>
    {items.length ? <div className="social-user-grid">{items.map((item) => {
      const person = direction === 'received' ? item.sender : item.recipient
      return <PublicUserCard key={item.id} person={person} meta={<>
        <span className={`wb-pill wb-pill-${requestClass[item.status]}`}>{requestLabel[item.status]}</span>
        <span>{direction === 'received' ? 'Received' : 'Sent'} {formatDateTime(item.created_at)}</span>
        {item.responded_at && <span>{requestLabel[item.status]} {formatDateTime(item.responded_at)}</span>}
      </>}>
        {item.status === 'PENDING' ? <FriendshipControls person={person} currentRelationship={{ status: direction === 'received' ? 'PENDING_RECEIVED' : 'PENDING_SENT', requestId: item.id }} /> : <span className="wb-muted">Request answered. Open the profile to see your current connection.</span>}
      </PublicUserCard>
    })}</div> : <EmptyState>{showAnswered ? `You have no ${direction} requests yet.` : `You have no pending ${direction} requests.`}</EmptyState>}
  </section>
}
