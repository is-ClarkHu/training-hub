import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AuthProvider, AuthGate, useAuth } from './features/auth'
import { LanguageProvider, useLanguage } from './i18n'
import { startSync } from './sync'
import { LogScreen } from './features/log'
import { HistoryScreen } from './features/history'
import { SportsScreen } from './features/sports'
import { InjuriesScreen } from './features/injuries'
import { CycleScreen } from './features/cycle'
import { DashboardScreen } from './features/dashboard'
import { SettingsScreen } from './features/settings'
import { AssistantScreen } from './features/assistant'
import './App.css'

// Tabs. Log + History are implemented; the rest are built module by module
// (SPEC §7, §12) and shown disabled for now.
const TABS = ['Log', 'History', 'Dashboard', 'Sports', 'Injuries', 'Cycle', 'Assistant', 'Settings'] as const
type Tab = (typeof TABS)[number]
const IMPLEMENTED: ReadonlySet<Tab> = new Set<Tab>([
  'Log', 'History', 'Dashboard', 'Sports', 'Injuries', 'Cycle', 'Assistant', 'Settings',
])

function AppShell() {
  const { session, signOut } = useAuth()
  const { lang, toggle } = useLanguage()
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('Log')

  // Background sync once authenticated (§3): now, on focus/online, every 2 min.
  useEffect(() => startSync(), [])

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
            {t('app.signOut')}
          </button>
        </div>
      </header>

      <nav className="app-tabs" aria-label="sections">
        {TABS.map((tb) => {
          const enabled = IMPLEMENTED.has(tb)
          return (
            <button
              key={tb}
              type="button"
              className={`app-tab ${tb === tab ? 'is-active' : ''} ${enabled ? '' : 'is-disabled'}`}
              onClick={() => enabled && setTab(tb)}
              disabled={!enabled}
            >
              {t(`tabs.${tb}`)}
            </button>
          )
        })}
      </nav>

      <main className="app-main">
        {tab === 'Log' && <LogScreen />}
        {tab === 'History' && <HistoryScreen />}
        {tab === 'Dashboard' && <DashboardScreen />}
        {tab === 'Sports' && <SportsScreen />}
        {tab === 'Injuries' && <InjuriesScreen />}
        {tab === 'Cycle' && <CycleScreen />}
        {tab === 'Assistant' && <AssistantScreen />}
        {tab === 'Settings' && <SettingsScreen />}
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
