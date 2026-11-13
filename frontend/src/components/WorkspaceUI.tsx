import type { ReactNode } from 'react'
import type { AssignmentStatus } from '../types/sports'
import { statusLabel } from '../services/format'

export function PageHeading({ kicker, title, description, actions }: {
  kicker: string; title: string; description?: string; actions?: ReactNode
}) {
  return <div className="wb-page-heading">
    <div><span className="wb-kicker">{kicker}</span><h1>{title}</h1>{description && <p>{description}</p>}</div>
    {actions && <div className="wb-inline-actions">{actions}</div>}
  </div>
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'error' | 'success'; children: ReactNode }) {
  return <div className={`wb-notice wb-notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="wb-empty">{children}</div>
}

export function MetricCard({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return <div className="wb-metric"><span className="wb-metric-label">{label}</span><strong className="wb-metric-value">{value}</strong>{note && <span className="wb-metric-note">{note}</span>}</div>
}

export function StatusPill({ status }: { status: AssignmentStatus }) {
  return <span className={`wb-pill wb-pill-${status}`}>{statusLabel(status)}</span>
}
