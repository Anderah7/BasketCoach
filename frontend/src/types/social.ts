import type { UserRole } from './auth'

export interface PublicUser {
  id: number
  username: string | null
  avatar_media_id: number | null
  role: UserRole
}

export type FriendshipStatus = 'SELF' | 'NONE' | 'PENDING_SENT' | 'PENDING_RECEIVED' | 'FRIENDS'
export type FriendRequestStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED'

export interface PublicProfile extends PublicUser {
  team: { id: number; name: string; category: string | null } | null
  position: string | null
  jersey_number: number | null
  friendship_status: FriendshipStatus
  friend_request_id: number | null
}

export interface UserSearchResponse {
  items: PublicUser[]
  total: number
  limit: number
  offset: number
}

export interface Friend extends PublicUser {
  friends_since: string
}

export interface FriendRequest {
  id: number
  sender: PublicUser
  recipient: PublicUser
  status: FriendRequestStatus
  created_at: string
  responded_at: string | null
}

export interface FriendRequestsResponse {
  received: FriendRequest[]
  sent: FriendRequest[]
}

export interface Relationship {
  status: FriendshipStatus
  requestId: number | null
}

export type FriendshipAction =
  | { type: 'send'; userId: number }
  | { type: 'remove'; userId: number }
  | { type: 'accept'; userId: number; requestId: number }
  | { type: 'reject'; userId: number; requestId: number }
