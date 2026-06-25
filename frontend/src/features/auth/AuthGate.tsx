// Gates the app behind a session (SPEC §7.0): no session → login screen only.
import type { ReactNode } from 'react'
import { useAuth } from './AuthProvider'
import { LoginScreen } from './LoginScreen'

export function AuthGate({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="auth-screen">
        <p className="auth-note">Loading…</p>
      </div>
    )
  }
  if (!session) return <LoginScreen />
  return <>{children}</>
}
