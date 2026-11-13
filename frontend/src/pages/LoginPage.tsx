import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { AuthPanel } from '../components/AuthPanel'
import { useAuth } from '../contexts/AuthContext'
import { ApiError } from '../services/api'
import { dashboardPath } from '../types/auth'

const REMEMBER_EMAIL_KEY = 'basketcoach.rememberedEmail'

function rememberedEmail(): string {
  try {
    return localStorage.getItem(REMEMBER_EMAIL_KEY) ?? ''
  } catch {
    return ''
  }
}

export function LoginPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { login } = useAuth()
  const registration = location.state as { registered?: boolean; email?: string } | null
  const [email, setEmail] = useState(registration?.email ?? rememberedEmail)
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(Boolean(rememberedEmail()))
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (!email.trim() || !password) {
      setError('Enter your email and password.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address.')
      return
    }
    if (password.length < 6) {
      setError('Your password must contain at least 6 characters.')
      return
    }

    setSubmitting(true)
    try {
      const user = await login({ email: email.trim(), password })
      try {
        if (remember) localStorage.setItem(REMEMBER_EMAIL_KEY, email.trim())
        else localStorage.removeItem(REMEMBER_EMAIL_KEY)
      } catch {
        // Browser storage can be disabled; login itself must still succeed.
      }
      navigate(dashboardPath[user.role], { replace: true })
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        setError('Incorrect email or password.')
      } else if (cause instanceof ApiError && cause.status === 403) {
        setError('Your account cannot access BasketCoach right now.')
      } else {
        setError(cause instanceof Error ? cause.message : 'Could not log in.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthPanel
      eyebrow="WELCOME BACK"
      title="Back on the court."
      description="Your next move starts here. Log in to your BasketCoach space."
      footer={<p>Don't have an account yet? <Link to="/register">Join BasketCoach <span aria-hidden="true">↗</span></Link></p>}
    >
      {registration?.registered && <p className="form-success" role="status">Account created. You can now log in.</p>}
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <label htmlFor="login-email">Email address</label>
        <input
          id="login-email" type="email" autoComplete="email" inputMode="email"
          placeholder="name@example.com" value={email}
          onChange={(event) => setEmail(event.target.value)} required
        />

        <label htmlFor="login-password">Password</label>
        <div className="password-field">
          <input
            id="login-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password"
            placeholder="Your password" value={password}
            onChange={(event) => setPassword(event.target.value)} required
          />
          <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>

        <label className="remember-row">
          <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
          <span>Remember me</span>
        </label>
        <p className="remember-hint">Only your email is remembered. Your session ends when you close this tab.</p>

        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button-primary submit-button" type="submit" disabled={submitting}>
          <span>{submitting ? 'Logging in...' : 'Log in'}</span>
          <span className="submit-arrow" aria-hidden="true">→</span>
        </button>
      </form>
    </AuthPanel>
  )
}
