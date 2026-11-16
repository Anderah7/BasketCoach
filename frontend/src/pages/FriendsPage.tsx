import { Link } from 'react-router'
import { FriendshipControls } from '../components/FriendshipControls'
import { PublicUserCard } from '../components/PublicUserCard'
import { EmptyState, Notice } from '../components/WorkspaceUI'
import { useFriends } from '../contexts/FriendsContext'
import { formatDate } from '../services/format'

export function FriendsPage() {
  const { data, loading } = useFriends()
  if (!data) return loading ? <Notice>Loading your friends...</Notice> : null
  return <section className="wb-card" aria-busy={loading}>
    <div className="wb-card-heading"><div><h2>My friends</h2><p>Select a friend to view their public profile.</p></div><Link className="wb-button wb-button-primary" to="/friends/search">+ Find people</Link></div>
    {data.friends.length ? <div className="social-user-grid">
      {data.friends.map((friend) => <PublicUserCard key={friend.id} person={friend} meta={<span>Friends since {formatDate(friend.friends_since)}</span>}><FriendshipControls person={friend} allowRemove /></PublicUserCard>)}
    </div> : <EmptyState>You have no friends yet. Find people by their username or accept a request to start connecting.</EmptyState>}
  </section>
}
