// Theme (light / dark / auto). Sets data-theme on <html>; auto follows the OS.
// Persisted in localStorage. Placed alongside i18n as another app-wide preference.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type ThemePref = 'light' | 'dark' | 'auto'
const KEY = 'th.theme'

function systemDark(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches
}
function resolve(pref: ThemePref): 'light' | 'dark' {
  if (pref === 'auto') return systemDark() ? 'dark' : 'light'
  return pref
}
function apply(pref: ThemePref) {
  document.documentElement.dataset.theme = resolve(pref)
}

interface ThemeCtx {
  pref: ThemePref
  setPref: (p: ThemePref) => void
}
const ThemeContext = createContext<ThemeCtx | undefined>(undefined)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(() => (localStorage.getItem(KEY) as ThemePref) || 'dark')

  useEffect(() => {
    apply(pref)
    if (pref !== 'auto') return
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => apply('auto')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [pref])

  function setPref(p: ThemePref) {
    localStorage.setItem(KEY, p)
    setPrefState(p)
  }

  return <ThemeContext.Provider value={{ pref, setPref }}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within <ThemeProvider>')
  return ctx
}
