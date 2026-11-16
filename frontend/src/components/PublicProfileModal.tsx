import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../contexts/AuthContext'
import { useFriends } from '../contexts/FriendsContext'
import { errorText, positionLabel } from '../services/format'
import { publicRoleLabel, publicUserLabel } from '../services/social'
import type { PublicProfile } from '../types/social'
import { DetailModal } from './DetailModal'
import { FriendshipControls } from './FriendshipControls'
import { Avatar } from './ProtectedMedia'
import { Notice } from './WorkspaceUI'

export function PublicProfileModal({ userId, onClose }: { userId: number; onClose: () => void }) {
  const { request, user } = useAuth()
  const { feedback, error: connectionError, loading: connectionsLoading, data, refresh } = useFriends()
  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)
  const mounted = useRef(true)

  const load = useCallback(async () => {
    if (!mounted.current) return
    controller.current?.abort()
    const current = new AbortController()
    controller.current = current
    setLoading(true); setError(null)
    try {
      const result = await request<PublicProfile>(`/users/${userId}/public`, { signal: current.signal })
      if (!current.signal.aborted && mounted.current) setProfile(result)
    } catch (cause) {
      if (!current.signal.aborted && mounted.current) { setError(errorText(cause)); setProfile(null) }
    } finally {
      if (!current.signal.aborted && mounted.current) setLoading(false)
    }
  }, [request, userId])

  useEffect(() => {
    mounted.current = true
    void load()
    return () => { mounted.current = false; controller.current?.abort() }
  }, [load])

  const hasSportingDetails = profile && (profile.team !== null || profile.position !== null || profile.jersey_number !== null)
  const accountPath = user?.role === 'player' ? '/player/profile' : `/${user?.role}/account`
  return <DetailModal title={profile ? publicUserLabel(profile) : 'Public profile'} onClose={onClose}>
    {feedback && <Notice kind={feedback.kind}>{feedback.message}</Notice>}
    {connectionError && <Notice kind="error">Could not refresh your connection: {connectionError} <button className="wb-button wb-button-link" type="button" disabled={connectionsLoading} onClick={() => void refresh()}>Try again</button></Notice>}
    {data === null && connectionsLoading && <Notice>Checking your connection...</Notice>}
    {error && <><Notice kind="error">{error}</Notice><div><button className="wb-button" type="button" onClick={() => void load()}>Try again</button></div></>}
    {loading && <Notice>Loading public profile...</Notice>}
    {profile && !loading && <>
      <div className="wb-player-identity"><Avatar id={profile.avatar_media_id} name={profile.username ?? 'User'} className="profile-avatar" /><div><h3>{publicUserLabel(profile)}</h3><span className="wb-pill">{publicRoleLabel[profile.role]}</span>{!profile.username && <p>This user has not set a public username yet.</p>}</div></div>
      <section className="wb-modal-section"><h3>Connection</h3><FriendshipControls person={profile} currentRelationship={{ status: profile.friendship_status, requestId: profile.friend_request_id }} allowRemove onChanged={load} />
        {profile.friendship_status === 'SELF' && <div><Link className="wb-button" to={accountPath} onClick={onClose}>Edit my profile</Link></div>}
      </section>
      <section className="wb-modal-section"><h3>Public sporting details</h3>
        {hasSportingDetails ? <dl className="wb-profile-grid">
          {profile.team && <div><dt>Team</dt><dd>{profile.team.name}{profile.team.category && <small className="social-team-category">{profile.team.category}</small>}</dd></div>}
          {profile.position !== null && <div><dt>Position</dt><dd>{positionLabel(profile.position)}</dd></div>}
          {profile.jersey_number !== null && <div><dt>Jersey number</dt><dd>{profile.jersey_number}</dd></div>}
        </dl> : <p className="wb-modal-description">No sporting details have been shared publicly.</p>}
      </section>
    </>}
  </DetailModal>
}
