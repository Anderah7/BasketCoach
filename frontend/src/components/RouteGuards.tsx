import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useAuth } from '../contexts/AuthContext'
import { dashboardPath } from '../types/auth'
import type { UserRole } from '../types/auth'

function SessionState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="session-state" role="status">
      <span className="session-state-mark" aria-hidden="true">BC</span>
      <h1>BasketCoach</h1>
      <p>{message}</p>
      {retry && <button className="button button-primary" onClick={retry}>Try again</button>}
    </div>
  )
}

export function GuestOnly({ children }: { children: ReactNode }) {
  const { user, loading, restoreError, retrySession } = useAuth()
  if (loading) return <SessionState message="Checking your session..." />
  if (restoreError) return <SessionState message={restoreError} retry={retrySession} />
  if (user) return <Navigate to={dashboardPath[user.role]} replace />
  return children
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, restoreError, retrySession } = useAuth()
  const location = useLocation()
  if (loading) return <SessionState message="Checking your session..." />
  if (restoreError) return <SessionState message={restoreError} retry={retrySession} />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return children
}

export function RequireRole({ role, children }: { role: UserRole; children: ReactNode }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== role) return <Navigate to={dashboardPath[user.role]} replace />
  return children
}
