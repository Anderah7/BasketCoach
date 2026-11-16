import type { ReactNode } from 'react'
import { useFriends } from '../contexts/FriendsContext'
import { publicRoleLabel, publicUserLabel } from '../services/social'
import type { PublicUser } from '../types/social'
import { Avatar } from './ProtectedMedia'

export function PublicUserCard({ person, children, meta }: { person: PublicUser; children?: ReactNode; meta?: ReactNode }) {
  const { openProfile, busy } = useFriends()
  const label = publicUserLabel(person)
  return <article className="social-user-card">
    <button className="social-user-trigger" type="button" disabled={busy !== null} onClick={() => openProfile(person.id)} aria-label={`Open public profile for ${label}`}>
      <Avatar id={person.avatar_media_id} name={person.username ?? 'User'} className="social-avatar" />
      <span className="social-user-identity"><strong>{label}</strong><span>{publicRoleLabel[person.role]}</span>{!person.username && <small>Username not set</small>}</span>
      <span className="wb-card-arrow" aria-hidden="true">↗</span>
    </button>
    {meta && <div className="social-user-meta">{meta}</div>}
    {children && <div className="social-user-actions">{children}</div>}
  </article>
}
