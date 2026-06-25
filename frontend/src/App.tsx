import { AuthProvider, AuthGate, useAuth } from './features/auth'
import './App.css'

// Placeholder authed shell. Real tabs (Log / History / Dashboard / Sports / …)
// land in later modules (SPEC §7); for now this proves the auth gate end-to-end.
const TABS = ['Log', 'History', 'Dashboard', 'Sports', 'Injuries', 'Cycle', 'Settings']

function AppShell() {
  const { session, signOut } = useAuth()
  return (
    <div className="app-shell">
      <header className="app-bar">
        <span className="app-logo">training&middot;hub</span>
        <div className="app-user">
          <span className="app-email">{session?.user.email}</span>
          <button className="th-btn-ghost app-logout" type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>
      <main className="app-main">
        <p className="app-hint">Signed in. Feature tabs are built module by module:</p>
        <ul className="app-tabs">
          {TABS.map((t) => (
            <li key={t} className="app-tab">{t}</li>
          ))}
        </ul>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AuthGate>
        <AppShell />
      </AuthGate>
    </AuthProvider>
  )
}
