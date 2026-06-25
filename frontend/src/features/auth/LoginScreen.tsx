// Login screen (SPEC §7.0). Email + password via Supabase Auth. v1 has no public
// sign-up — the single account is created in the Supabase dashboard. The markup
// leaves room to add a sign-up form later (opening to ~10 users needs no schema
// change, §3).
import { useState, type FormEvent } from 'react'
import { useAuth } from './AuthProvider'
import './auth.css'

export function LoginScreen() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await signIn(email.trim(), password)
    if (error) setError(error)
    setBusy(false)
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={onSubmit} noValidate>
        <div className="auth-brand">
          <span className="auth-trace" aria-hidden="true" />
          <h1>training&middot;hub</h1>
          <p className="auth-sub">Sign in to your training log</p>
        </div>

        <div className="auth-field">
          <label className="th-label" htmlFor="email">Email</label>
          <input
            id="email"
            className="th-input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </div>

        <div className="auth-field">
          <label className="th-label" htmlFor="password">Password</label>
          <input
            id="password"
            className="th-input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {error && <p className="th-error" role="alert">{error}</p>}

        <button className="th-btn" type="submit" disabled={busy || !email || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="auth-note">
          Accounts are invite-only in v1. Ask the owner to create yours.
        </p>
      </form>
    </div>
  )
}
