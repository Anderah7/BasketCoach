import { Link } from 'react-router'

export function Brand({ to = '/' }: { to?: string }) {
  return (
    <Link className="brand" to={to} aria-label="BasketCoach, ir al inicio">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 48 48" fill="none">
          <circle cx="24" cy="24" r="18" stroke="currentColor" strokeWidth="2.4" />
          <path d="M24 6v36M6 24h36M11.3 11.3c9.2 3.5 16.2 15.3 18.5 29.2M36.7 11.3c-9.2 3.5-16.2 15.3-18.5 29.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>
      <span>Basket<span>Coach</span></span>
    </Link>
  )
}
