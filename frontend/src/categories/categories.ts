// Exercise categories (formerly the fixed 7 body parts). Now user-editable:
// built-in defaults + custom categories the user adds (e.g. pull, upper body).
// Custom categories live in localStorage; the exercise row stores the category key.
// (frisbee is gone as a category — "sports" replaces it; warmup is now a category.)
import { useEffect, useReducer } from 'react'
import type { TranslationTarget } from '../translation'

export interface Category {
  key: string
  zh: string
  en: string
  custom?: boolean
}

export const DEFAULT_CATEGORIES: Category[] = [
  { key: 'chest', zh: '胸部', en: 'Chest' },
  { key: 'back', zh: '背部', en: 'Back' },
  { key: 'shoulders', zh: '肩部', en: 'Shoulders' },
  { key: 'legs', zh: '腿部', en: 'Legs' },
  { key: 'arms', zh: '手臂', en: 'Arms' },
  { key: 'biceps', zh: '肱二头肌', en: 'Biceps' },
  { key: 'triceps', zh: '肱三头肌', en: 'Triceps' },
  { key: 'core', zh: '核心', en: 'Core' },
  { key: 'cardio', zh: '有氧', en: 'Cardio' },
  { key: 'warmup', zh: '热身', en: 'Warm-up' },
  { key: 'sports', zh: '运动', en: 'Sports' },
]

const LS = 'th.categories.custom'
const LS_OVERRIDES = 'th.categories.overrides' // renamed labels for built-in categories
const DEFAULT_KEYS = new Set(DEFAULT_CATEGORIES.map((d) => d.key))
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

// One-time heal: physically drop any stored custom whose key collides with a
// built-in. Such rows (e.g. an old custom "二头"/"三头"/"有氧") produced duplicate
// category keys → duplicate React keys → drag broke on those groups.
;(() => {
  try {
    const raw = localStorage.getItem(LS)
    if (!raw) return
    const list = JSON.parse(raw) as Category[]
    const cleaned = list.filter((c) => !DEFAULT_KEYS.has(c.key))
    if (cleaned.length !== list.length) {
      localStorage.setItem(LS, JSON.stringify(cleaned.map(({ key, zh, en }) => ({ key, zh, en }))))
    }
  } catch { /* ignore */ }
})()

type Override = { zh: string; en: string }
function loadOverrides(): Record<string, Override> {
  try { return JSON.parse(localStorage.getItem(LS_OVERRIDES) ?? '{}') as Record<string, Override> } catch { return {} }
}
function saveOverrides(o: Record<string, Override>) {
  localStorage.setItem(LS_OVERRIDES, JSON.stringify(o))
  notify()
}
/** Built-ins with any renamed labels applied. */
function builtins(): Category[] {
  const ov = loadOverrides()
  return DEFAULT_CATEGORIES.map((d) => (ov[d.key] ? { ...d, zh: ov[d.key].zh || d.zh, en: ov[d.key].en || d.en } : d))
}

function loadCustom(): Category[] {
  try {
    const raw = localStorage.getItem(LS)
    if (!raw) return []
    return (JSON.parse(raw) as Category[])
      // Never let a custom category shadow a built-in key: an older custom
      // "二头/三头" (slug biceps/triceps) would collide with the defaults we now
      // ship, producing duplicate React keys that break the drag on those groups.
      .filter((c) => !DEFAULT_KEYS.has(c.key))
      .map((c) => ({ ...c, custom: true }))
  } catch {
    return []
  }
}
function saveCustom(list: Category[]) {
  localStorage.setItem(LS, JSON.stringify(list.map(({ key, zh, en }) => ({ key, zh, en }))))
  notify()
}

export function getCategories(): Category[] {
  const seen = new Set<string>()
  const out: Category[] = []
  for (const c of [...builtins(), ...loadCustom()]) {
    if (seen.has(c.key)) continue // guard against any duplicate key
    seen.add(c.key)
    out.push(c)
  }
  return out
}

/** Just the keys (compat with the old BODY_PARTS array). */
export function categoryKeys(): string[] {
  return getCategories().map((c) => c.key)
}

export function categoryLabel(key: string, lang: TranslationTarget): string {
  const c = getCategories().find((x) => x.key === key)
  return c ? (lang === 'zh' ? c.zh : c.en) : key
}

export function isCustomCategory(key: string): boolean {
  return loadCustom().some((c) => c.key === key)
}

function slug(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `cat_${Date.now()}`
}

export function addCategory(input: { zh: string; en: string }): Category {
  const key = slug(input.en || input.zh)
  // Don't create a custom category that collides with a built-in — reuse the default.
  const builtin = DEFAULT_CATEGORIES.find((d) => d.key === key)
  if (builtin) return { ...builtin }
  const cat: Category = { key, zh: input.zh.trim(), en: input.en.trim(), custom: true }
  const custom = loadCustom().filter((c) => c.key !== key)
  saveCustom([...custom, cat])
  return cat
}
export function updateCategory(key: string, patch: { zh?: string; en?: string }): void {
  if (DEFAULT_KEYS.has(key)) {
    // Renaming a built-in: persist the new labels as an override.
    const ov = loadOverrides()
    ov[key] = { zh: (patch.zh ?? ov[key]?.zh ?? '').trim(), en: (patch.en ?? ov[key]?.en ?? '').trim() }
    saveOverrides(ov)
    return
  }
  saveCustom(loadCustom().map((c) => (c.key === key ? { ...c, ...patch } : c)))
}
export function removeCategory(key: string): void {
  saveCustom(loadCustom().filter((c) => c.key !== key))
}

/** Capture the category stores (custom + built-in overrides); returns an undo fn. */
export function snapshotCategories(): () => void {
  const rawCustom = localStorage.getItem(LS)
  const rawOv = localStorage.getItem(LS_OVERRIDES)
  return () => {
    if (rawCustom == null) localStorage.removeItem(LS); else localStorage.setItem(LS, rawCustom)
    if (rawOv == null) localStorage.removeItem(LS_OVERRIDES); else localStorage.setItem(LS_OVERRIDES, rawOv)
    notify()
  }
}

/** Reactive list — re-renders when categories change. */
export function useCategories(): Category[] {
  const [, force] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    listeners.add(force)
    return () => { listeners.delete(force) }
  }, [])
  return getCategories()
}
