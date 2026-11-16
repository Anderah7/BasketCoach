import { Link, NavLink, Outlet } from 'react-router'
import { useAuth } from '../contexts/AuthContext'
import { FriendsProvider, useFriends } from '../contexts/FriendsContext'
import { PublicProfileModal } from './PublicProfileModal'
import { Notice, PageHeading } from './WorkspaceUI'

function FriendsWorkspace() {
  const { user } = useAuth()
  const { data, loading, error, feedback, busy, refresh, selectedProfileId, closeProfile } = useFriends()
  const incoming = data?.requests.received.filter((item) => item.status === 'PENDING').length ?? 0
  const accountPath = user?.role === 'player' ? '/player/profile' : `/${user?.role}/account`
  return <main className="wb-page">
    <PageHeading kicker="COMMUNITY" title="Friends" description="Find your basketball community, connect and keep in touch." actions={<button className="wb-button" type="button" onClick={() => void refresh()} disabled={loading || busy !== null}>{loading ? 'Refreshing...' : 'Refresh'}</button>} />
    <nav className="social-navigation" aria-label="Friends navigation">
      <NavLink to="/friends" end>My friends{data && <span>{data.friends.length}</span>}</NavLink>
      <NavLink to="/friends/search">Find people</NavLink>
      <NavLink to="/friends/requests">Requests{incoming > 0 && <span>{incoming} new</span>}</NavLink>
    </nav>
    {error && <Notice kind="error">Could not refresh your friendships: {error}</Notice>}
    {feedback && <Notice kind={feedback.kind}>{feedback.message}</Notice>}
    {!user?.username && <Notice>Choose a username so others can find you. <Link className="social-text-link" to={accountPath}>Set my username</Link></Notice>}
    <Outlet />
    {selectedProfileId !== null && <PublicProfileModal key={selectedProfileId} userId={selectedProfileId} onClose={closeProfile} />}
  </main>
}

export function FriendsLayout() {
  return <FriendsProvider><FriendsWorkspace /></FriendsProvider>
}
