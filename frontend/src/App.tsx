import { useState } from 'react'
import { AuthProvider, AuthGate, useAuth } from './features/auth'
import { LanguageProvider, useLanguage } from './i18n'
import { LogScreen } from './features/log'
import { HistoryScreen } from './features/history'
import { SportsScreen } from './features/sports'
import { InjuriesScreen } from './features/injuries'
import './App.css'

// Tabs. Log + History are implemented; the rest are built module by module
// (SPEC §7, §12) and shown disabled for now.
const TABS = ['Log', 'History', 'Dashboard', 'Sports', 'Injuries', 'Cycle', 'Settings'] as const
type Tab = (typeof TABS)[number]
const IMPLEMENTED: ReadonlySet<Tab> = new Set<Tab>(['Log', 'History', 'Sports', 'Injuries'])

function AppShell() {
  const { session, signOut } = useAuth()
  const { lang, toggle } = useLanguage()
  const [tab, setTab] = useState<Tab>('Log')

  return (
    <div className="app-shell">
      <header className="app-bar">
        <span className="app-logo">training&middot;hub</span>
        <div className="app-user">
          <button className="th-btn-ghost app-lang" type="button" onClick={toggle} aria-label="toggle language">
            {lang === 'en' ? '中 / EN' : 'EN / 中'}
          </button>
          <span className="app-email">{session?.user.email}</span>
          <button className="th-btn-ghost app-logout" type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>

      <nav className="app-tabs" aria-label="sections">
        {TABS.map((t) => {
          const enabled = IMPLEMENTED.has(t)
          return (
            <button
              key={t}
              type="button"
              className={`app-tab ${t === tab ? 'is-active' : ''} ${enabled ? '' : 'is-disabled'}`}
              onClick={() => enabled && setTab(t)}
              disabled={!enabled}
            >
              {t}
            </button>
          )
        })}
      </nav>

      <main className="app-main">
        {tab === 'Log' && <LogScreen />}
        {tab === 'History' && <HistoryScreen />}
        {tab === 'Sports' && <SportsScreen />}
        {tab === 'Injuries' && <InjuriesScreen />}
      </main>
    </div>
  )
}

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <AuthGate>
          <AppShell />
        </AuthGate>
      </AuthProvider>
    </LanguageProvider>
  )
}
