// Login screen (SPEC §7.0). Email + password via Supabase Auth. v1 has no public
// sign-up — the single account is created in the Supabase dashboard. The markup
// leaves room to add a sign-up form later (opening to ~10 users needs no schema
// change, §3).
import { useState, type FormEvent } from 'react'
import { useAuth } from './AuthProvider'
import './auth.css'

// The public demo account, reset from scratch every night by a GitHub Actions job.
// These are not secrets: they are printed in the README and on the repo page, and the
// account is bound by the same row-level security as any other, so it can only ever
// reach its own rows. Landing on `?demo` fills the form in so a visitor following the
// link from the README doesn't have to copy two strings across; it never submits for
// them, and no other code path reads these.
const DEMO = { email: 'demo@training-hub.app', password: 'demo-training-hub' }
const wantsDemo = (): boolean =>
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('demo')

export function LoginScreen() {
  const { signIn } = useAuth()
  const [demo] = useState(wantsDemo)
  const [email, setEmail] = useState(() => (wantsDemo() ? DEMO.email : ''))
  const [password, setPassword] = useState(() => (wantsDemo() ? DEMO.password : ''))
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
          <p className="auth-sub">{demo ? 'Demo account — just press Sign in' : 'Sign in to your training log'}</p>
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
            autoFocus={!demo}
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

        <button className="th-btn" type="submit" disabled={busy || !email || !password} autoFocus={demo}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="auth-note">
          {demo
            ? 'This account is wiped and rebuilt every night, so feel free to change anything.'
            : 'Accounts are invite-only in v1. Ask the owner to create yours.'}
        </p>
      </form>
    </div>
  )
}
