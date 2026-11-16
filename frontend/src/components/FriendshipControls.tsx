import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useFriends } from '../contexts/FriendsContext'
import { publicUserLabel } from '../services/social'
import type { FriendshipAction, PublicUser, Relationship } from '../types/social'

export function FriendshipControls({ person, currentRelationship, allowRemove = false, onChanged }: {
  person: Pick<PublicUser, 'id' | 'username'>
  currentRelationship?: Relationship
  allowRemove?: boolean
  onChanged?: () => Promise<void>
}) {
  const { relationship, perform, busy, loading, data } = useFriends()
  const relation = currentRelationship ?? relationship(person.id)
  const [working, setWorking] = useState(false)
  const [confirmRemoval, setConfirmRemoval] = useState(false)
  const disabled = working || busy !== null || loading || data === null
  const label = publicUserLabel(person)

  useEffect(() => { setConfirmRemoval(false) }, [relation.status, person.id])

  async function act(action: FriendshipAction) {
    if (disabled) return
    setWorking(true)
    try {
      const changed = await perform(action)
      if (changed) setConfirmRemoval(false)
      await onChanged?.()
    } finally { setWorking(false) }
  }

  if (relation.status === 'SELF') return <span className="wb-pill">You</span>
  if (data === null && !currentRelationship) return <button className="wb-button" type="button" disabled>Checking connection...</button>
  if (relation.status === 'PENDING_SENT') return <button className="wb-button social-pending-button" type="button" disabled>Request pending</button>
  if (relation.status === 'PENDING_RECEIVED') {
    const requestId = relation.requestId
    return <div className="social-action-group">
      <span className="wb-pill wb-pill-PENDING">Incoming request</span>
      {requestId === null ? <Link className="wb-button" to="/friends/requests">View requests</Link> : <div className="wb-inline-actions">
        <button className="wb-button wb-button-primary" type="button" disabled={disabled} onClick={() => void act({ type: 'accept', userId: person.id, requestId })} aria-label={`Accept friend request from ${label}`}>{working ? 'Updating...' : 'Accept'}</button>
        <button className="wb-button" type="button" disabled={disabled} onClick={() => void act({ type: 'reject', userId: person.id, requestId })} aria-label={`Reject friend request from ${label}`}>Reject</button>
      </div>}
    </div>
  }
  if (relation.status === 'FRIENDS') return <div className="social-action-group">
    <div className="social-friend-actions">
      <Link className="wb-button wb-button-primary" to={`/chat?user=${person.id}`} aria-label={`Message ${label}`}>Message</Link>
      {allowRemove && !confirmRemoval && <button className="wb-button wb-button-danger" type="button" disabled={disabled} onClick={() => setConfirmRemoval(true)} aria-label={`Remove ${label} from friends`}>Remove friend</button>}
    </div>
    {confirmRemoval && <div className="social-remove-confirmation"><p>Remove {label} from your friends?</p><div className="wb-inline-actions"><button className="wb-button wb-button-danger" type="button" disabled={disabled} onClick={() => void act({ type: 'remove', userId: person.id })}>{working ? 'Removing...' : 'Confirm removal'}</button><button className="wb-button" type="button" disabled={disabled} onClick={() => setConfirmRemoval(false)}>Cancel</button></div></div>}
  </div>
  return <button className="wb-button wb-button-primary" type="button" disabled={disabled} onClick={() => void act({ type: 'send', userId: person.id })} aria-label={`Send a friend request to ${label}`}>{working ? 'Sending...' : '+ Add friend'}</button>
}
