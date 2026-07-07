import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AuthProvider, AuthGate, useAuth } from './features/auth'
import { LanguageProvider, ThemeProvider, useLanguage } from './i18n'
import { UndoProvider } from './undo'
import { startSync } from './sync'
import { LogScreen } from './features/log'
import { HistoryScreen } from './features/history'
import { InjuriesScreen } from './features/injuries'
import { CycleScreen } from './features/cycle'
import { DashboardScreen } from './features/dashboard'
import { SettingsScreen } from './features/settings'
import { AssistantScreen } from './features/assistant'
import './App.css'

// Tabs. Log + History are implemented; the rest are built module by module
// (SPEC §7, §12) and shown disabled for now.
const TABS = ['Log', 'History', 'Dashboard', 'Injuries', 'Cycle', 'Assistant', 'Settings'] as const
type Tab = (typeof TABS)[number]
const IMPLEMENTED: ReadonlySet<Tab> = new Set<Tab>([
  'Log', 'History', 'Dashboard', 'Injuries', 'Cycle', 'Assistant', 'Settings',
])

function AppShell() {
  const { session, signOut } = useAuth()
  const { lang, toggle } = useLanguage()
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('Log')
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Background sync once authenticated (§3): now, on focus/online, every 2 min.
  useEffect(() => startSync(), [])

  function pick(tb: Tab) {
    setTab(tb)
    setDrawerOpen(false)
  }

  return (
    <div className="app-shell">
      <header className="app-bar">
        <button className="app-burger" type="button" aria-label="menu" onClick={() => setDrawerOpen(true)}>
          <span /><span /><span />
        </button>
        <span className="app-logo">training&middot;hub</span>
        <span className="app-current">{t(`tabs.${tab}`)}</span>
        <div className="app-user">
          <button className="th-btn-ghost app-lang" type="button" onClick={toggle} aria-label="toggle language">
            {lang === 'en' ? '中 / EN' : 'EN / 中'}
          </button>
          <button className="th-btn-ghost app-logout" type="button" onClick={() => void signOut()}>
            {t('app.signOut')}
          </button>
        </div>
      </header>

      {/* Persistent sidebar on wide screens; slide-in drawer on narrow. */}
      {drawerOpen && <div className="app-drawer-backdrop" onClick={() => setDrawerOpen(false)} />}
      <div className="app-body">
        <aside className={`app-drawer ${drawerOpen ? 'open' : ''}`}>
          <div className="app-drawer-head">
            <span className="app-drawer-email">{session?.user.email}</span>
          </div>
          <nav aria-label="sections">
            {TABS.map((tb) => {
              const enabled = IMPLEMENTED.has(tb)
              return (
                <button
                  key={tb}
                  type="button"
                  className={`app-drawer-item ${tb === tab ? 'is-active' : ''}`}
                  onClick={() => enabled && pick(tb)}
                  disabled={!enabled}
                >
                  {t(`tabs.${tb}`)}
                </button>
              )
            })}
          </nav>
        </aside>

        <main className="app-main">
          {tab === 'Log' && <LogScreen />}
          {tab === 'History' && <HistoryScreen />}
          {tab === 'Dashboard' && <DashboardScreen />}
          {tab === 'Injuries' && <InjuriesScreen />}
          {tab === 'Cycle' && <CycleScreen />}
          {tab === 'Assistant' && <AssistantScreen />}
          {tab === 'Settings' && <SettingsScreen />}
        </main>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <AuthProvider>
          <AuthGate>
            <UndoProvider>
              <AppShell />
            </UndoProvider>
          </AuthGate>
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  )
}
