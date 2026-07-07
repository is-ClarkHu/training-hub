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
  { key: 'chest', zh: '胸', en: 'Chest' },
  { key: 'back', zh: '背', en: 'Back' },
  { key: 'shoulders', zh: '肩', en: 'Shoulders' },
  { key: 'legs', zh: '腿', en: 'Legs' },
  { key: 'arms', zh: '手臂', en: 'Arms' },
  { key: 'biceps', zh: '二头', en: 'Biceps' },
  { key: 'triceps', zh: '三头', en: 'Triceps' },
  { key: 'core', zh: '腹', en: 'Core' },
  { key: 'cardio', zh: '有氧', en: 'Cardio' },
  { key: 'warmup', zh: '热身', en: 'Warmup' },
  { key: 'sports', zh: '运动', en: 'Sports' },
]

const LS = 'th.categories.custom'
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

function loadCustom(): Category[] {
  try {
    const raw = localStorage.getItem(LS)
    if (!raw) return []
    return (JSON.parse(raw) as Category[]).map((c) => ({ ...c, custom: true }))
  } catch {
    return []
  }
}
function saveCustom(list: Category[]) {
  localStorage.setItem(LS, JSON.stringify(list.map(({ key, zh, en }) => ({ key, zh, en }))))
  notify()
}

export function getCategories(): Category[] {
  return [...DEFAULT_CATEGORIES, ...loadCustom()]
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
  const cat: Category = { key, zh: input.zh.trim(), en: input.en.trim(), custom: true }
  const custom = loadCustom().filter((c) => c.key !== key)
  saveCustom([...custom, cat])
  return cat
}
export function updateCategory(key: string, patch: { zh?: string; en?: string }): void {
  saveCustom(loadCustom().map((c) => (c.key === key ? { ...c, ...patch } : c)))
}
export function removeCategory(key: string): void {
  saveCustom(loadCustom().filter((c) => c.key !== key))
}

/** Capture the custom-category store; returns a fn that restores it (for undo). */
export function snapshotCategories(): () => void {
  const raw = localStorage.getItem(LS)
  return () => {
    if (raw == null) localStorage.removeItem(LS)
    else localStorage.setItem(LS, raw)
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
