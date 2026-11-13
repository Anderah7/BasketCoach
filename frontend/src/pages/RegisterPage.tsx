import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { AuthPanel } from '../components/AuthPanel'
import { ApiError } from '../services/api'
import { authService } from '../services/auth'
import type { UserRole } from '../types/auth'

const roles: { value: UserRole; label: string; description: string }[] = [
  { value: 'coach', label: 'Coach', description: 'I lead the team' },
  { value: 'player', label: 'Player', description: 'I play the game' },
  { value: 'fan', label: 'Fan', description: 'I follow every play' },
]

export function RegisterPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<UserRole>('player')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const cleanName = name.trim()
    const cleanEmail = email.trim().toLowerCase()
    if (!cleanName || cleanName.length > 100) {
      setError('Your name must be between 1 and 100 characters.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('Enter a valid email address.')
      return
    }
    if (password.length < 6) {
      setError('Your password must contain at least 6 characters.')
      return
    }

    setSubmitting(true)
    try {
      await authService.register({ name: cleanName, email: cleanEmail, password, role })
      navigate('/login', { replace: true, state: { registered: true, email: cleanEmail } })
    } catch (cause) {
      if (cause instanceof ApiError && (cause.status === 400 || cause.status === 409)) {
        setError('That email is already registered. Try logging in.')
      } else {
        setError(cause instanceof Error ? cause.message : 'Could not create your account.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthPanel
      eyebrow="YOUR STORY STARTS HERE"
      title="Get in the game."
      description="Create your account and find your place in BasketCoach."
      footer={<p>Already part of the team? <Link to="/login">Log in <span aria-hidden="true">↗</span></Link></p>}
      wide
    >
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <label htmlFor="register-name">Name</label>
        <input id="register-name" type="text" autoComplete="name" maxLength={100} placeholder="Your name" value={name} onChange={(event) => setName(event.target.value)} required />

        <label htmlFor="register-email">Email address</label>
        <input id="register-email" type="email" autoComplete="email" inputMode="email" maxLength={200} placeholder="name@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required />

        <label htmlFor="register-password">Password</label>
        <input id="register-password" type="password" autoComplete="new-password" minLength={6} placeholder="At least 6 characters" value={password} onChange={(event) => setPassword(event.target.value)} required />

        <fieldset className="role-fieldset">
          <legend>What is your role?</legend>
          <div className="role-options">
            {roles.map((option) => (
              <label className={`role-option${role === option.value ? ' selected' : ''}`} key={option.value}>
                <input type="radio" name="role" value={option.value} checked={role === option.value} onChange={() => setRole(option.value)} />
                <span className="role-name">{option.label}</span>
                <span className="role-description">{option.description}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button-primary submit-button" type="submit" disabled={submitting}>
          <span>{submitting ? 'Creating account...' : 'Create my account'}</span>
          <span className="submit-arrow" aria-hidden="true">→</span>
        </button>
      </form>
    </AuthPanel>
  )
}
