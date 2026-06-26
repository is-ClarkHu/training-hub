// UI-chrome i18n (SPEC §12.13). i18next holds translated labels (tab names, app
// chrome). DATA translation (exercise names, note tags, sport tiers) goes through
// the translation subsystem (resolve()), not here. The two share one language
// signal: LanguageProvider calls i18n.changeLanguage when the toggle flips.
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './en.json'
import zh from './zh.json'

function detect(): 'en' | 'zh' {
  if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('zh')) return 'zh'
  return 'en'
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, zh: { translation: zh } },
  lng: detect(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export default i18n
