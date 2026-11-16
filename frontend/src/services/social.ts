import type { PublicUser } from '../types/social'
import type { UserRole } from '../types/auth'

export function publicUserLabel(user: Pick<PublicUser, 'id' | 'username'>): string {
  return user.username ? `@${user.username}` : `User #${user.id}`
}

export const publicRoleLabel: Record<UserRole, string> = {
  coach: 'Coach', player: 'Player', fan: 'Fan',
}
