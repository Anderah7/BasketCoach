import type { ReactNode } from 'react'
import { Link } from 'react-router'

interface AuthPanelProps {
  eyebrow: string
  title: string
  description: string
  children: ReactNode
  footer: ReactNode
  wide?: boolean
}

export function AuthPanel({ eyebrow, title, description, children, footer, wide = false }: AuthPanelProps) {
  return (
    <main className="auth-stage">
      <section className={`auth-card${wide ? ' auth-card-wide' : ''}`} aria-labelledby="auth-title">
        <Link className="card-close" to="/" aria-label="Close and return home">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M6 6 18 18M18 6 6 18" />
          </svg>
        </Link>
        <span className="eyebrow">{eyebrow}</span>
        <h1 id="auth-title">{title}</h1>
        <p className="auth-description">{description}</p>
        {children}
        <div className="auth-card-footer">{footer}</div>
      </section>
    </main>
  )
}
