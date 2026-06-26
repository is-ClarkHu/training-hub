import { AuthProvider, AuthGate, useAuth } from './features/auth'
import { LogScreen } from './features/log'
import './App.css'

// Tab bar. Only Log is implemented so far; the rest are built module by module
// (SPEC §7, §12) and shown as disabled placeholders for now.
const TABS = ['Log', 'History', 'Dashboard', 'Sports', 'Injuries', 'Cycle', 'Settings'] as const

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
      <nav className="app-tabs" aria-label="sections">
        {TABS.map((t) => (
          <span key={t} className={`app-tab ${t === 'Log' ? 'is-active' : 'is-disabled'}`}>{t}</span>
        ))}
      </nav>
      <main className="app-main">
        <LogScreen />
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
