import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ApiError, apiRequest, apiRequestBlob } from '../services/api'
import type { ApiRequestOptions } from '../services/api'
import { authService } from '../services/auth'
import type { AuthUser, LoginCredentials } from '../types/auth'

const TOKEN_KEY = 'basketcoach.accessToken'

interface Session {
  token: string
  user: AuthUser
}

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  restoreError: string | null
  login: (credentials: LoginCredentials) => Promise<AuthUser>
  logout: () => void
  retrySession: () => void
  request: <T>(path: string, options?: Omit<ApiRequestOptions, 'token'>) => Promise<T>
  requestBlob: (path: string, signal?: AbortSignal) => Promise<Blob>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const restoreController = useRef<AbortController | null>(null)

  const logout = useCallback(() => {
    restoreController.current?.abort()
    sessionStorage.removeItem(TOKEN_KEY)
    setSession(null)
    setRestoreError(null)
    setLoading(false)
  }, [])

  const verifyStoredSession = useCallback(async (signal: AbortSignal) => {
    const token = sessionStorage.getItem(TOKEN_KEY)
    if (!token) {
      setLoading(false)
      return
    }

    setLoading(true)
    setRestoreError(null)
    try {
      const user = await authService.me(token, signal)
      if (!signal.aborted) setSession({ token, user })
    } catch (error) {
      if (signal.aborted) return
      if (error instanceof ApiError && error.status === 401) {
        sessionStorage.removeItem(TOKEN_KEY)
        setSession(null)
      } else {
        setRestoreError(error instanceof Error ? error.message : 'Could not verify your session.')
      }
    } finally {
      if (!signal.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    restoreController.current = controller
    void verifyStoredSession(controller.signal)
    return () => controller.abort()
  }, [verifyStoredSession])

  const retrySession = useCallback(() => {
    restoreController.current?.abort()
    const controller = new AbortController()
    restoreController.current = controller
    void verifyStoredSession(controller.signal)
  }, [verifyStoredSession])

  const login = useCallback(async (credentials: LoginCredentials): Promise<AuthUser> => {
    const { access_token } = await authService.login(credentials)
    const user = await authService.me(access_token)
    restoreController.current?.abort()
    sessionStorage.setItem(TOKEN_KEY, access_token)
    setSession({ token: access_token, user })
    setRestoreError(null)
    setLoading(false)
    return user
  }, [])

  const request = useCallback(async <T,>(
    path: string,
    options: Omit<ApiRequestOptions, 'token'> = {},
  ): Promise<T> => {
    if (!session) throw new ApiError(401, 'Log in to continue.')
    try {
      return await apiRequest<T>(path, { ...options, token: session.token })
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) logout()
      throw error
    }
  }, [session, logout])

  const requestBlob = useCallback(async (path: string, signal?: AbortSignal): Promise<Blob> => {
    if (!session) throw new ApiError(401, 'Log in to continue.')
    try { return await apiRequestBlob(path, { token: session.token, signal }) }
    catch (error) { if (error instanceof ApiError && error.status === 401) logout(); throw error }
  }, [session, logout])

  const refreshUser = useCallback(async () => {
    if (!session) throw new ApiError(401, 'Log in to continue.')
    const user = await authService.me(session.token)
    setSession((current) => current?.token === session.token ? { ...current, user } : current)
  }, [session])

  return (
    <AuthContext.Provider value={{
      user: session?.user ?? null,
      loading,
      restoreError,
      login,
      logout,
      retrySession,
      request,
      requestBlob,
      refreshUser,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return context
}
