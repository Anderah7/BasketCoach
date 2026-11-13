export type UserRole = 'coach' | 'player' | 'fan'

export interface AuthUser {
  id: number
  name: string
  email: string
  role: UserRole
  is_active: boolean
  created_at: string
  avatar_media_id: number | null
}

export interface LoginCredentials {
  email: string
  password: string
}

export interface RegisterData extends LoginCredentials {
  name: string
  role: UserRole
}

export interface TokenResponse {
  access_token: string
  token_type: 'bearer'
}

export const dashboardPath: Record<UserRole, string> = {
  coach: '/coach/dashboard',
  player: '/player/dashboard',
  fan: '/fan/dashboard',
}
