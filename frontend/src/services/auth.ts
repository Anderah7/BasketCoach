import { apiRequest } from './api'
import type { AuthUser, LoginCredentials, RegisterData, TokenResponse } from '../types/auth'

export const authService = {
  login: (credentials: LoginCredentials) =>
    apiRequest<TokenResponse>('/users/login', { method: 'POST', body: credentials }),

  register: (data: RegisterData) =>
    apiRequest<AuthUser>('/users/register', { method: 'POST', body: data }),

  me: (token: string, signal?: AbortSignal) =>
    apiRequest<AuthUser>('/users/me', { token, signal }),
}
