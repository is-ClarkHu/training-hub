// App-wide language state (SPEC §3: default follows the browser; user toggles
// zh/en anytime and the toggle re-renders DATA, not just labels). UI-chrome i18n
// (en.json/zh.json via i18next) is wired in a later module; this provides the
// shared lang signal that data rendering and resolve() consume now.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { TranslationTarget } from '../translation'
import i18n from './i18n'

function detect(): TranslationTarget {
  if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('zh')) {
    return 'zh'
  }
  return 'en'
}

interface LanguageContextValue {
  lang: TranslationTarget
  setLang: (l: TranslationTarget) => void
  toggle: () => void
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<TranslationTarget>(detect)
  const toggle = () => setLang((l) => (l === 'en' ? 'zh' : 'en'))

  // Keep i18next (UI chrome) in lockstep with the data language.
  useEffect(() => {
    void i18n.changeLanguage(lang)
  }, [lang])
  return (
    <LanguageContext.Provider value={{ lang, setLang, toggle }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used within <LanguageProvider>')
  return ctx
}
