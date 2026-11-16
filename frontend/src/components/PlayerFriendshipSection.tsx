import { FriendsProvider, useFriends } from '../contexts/FriendsContext'
import { FriendshipControls } from './FriendshipControls'
import { Notice } from './WorkspaceUI'

function PlayerConnection({ userId }: { userId: number }) {
  const { data, loading, error, feedback, busy, refresh } = useFriends()
  return <section className="wb-modal-section">
    <h3>Friendship</h3>
    {feedback && <Notice kind={feedback.kind}>{feedback.message}</Notice>}
    {error && <Notice kind="error">Could not check your friendship: {error} <button className="wb-button wb-button-link" type="button" disabled={loading || busy !== null} onClick={() => void refresh()}>Try again</button></Notice>}
    {!data && loading && <Notice>Checking your friendship...</Notice>}
    {data && <FriendshipControls person={{ id: userId, username: null }} />}
  </section>
}

export function PlayerFriendshipSection({ userId }: { userId: number }) {
  return <FriendsProvider key={userId}><PlayerConnection userId={userId} /></FriendsProvider>
}
