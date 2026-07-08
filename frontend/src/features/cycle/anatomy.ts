// Anatomical regions for the body model (§6B P2). These are the FIXED fine-grained
// muscles the figure lights up — distinct from the user-editable coarse Categories.
// A category maps to a set of regions (editable, drag-to-assign); logging a lift in
// a category lights all its regions, brighter with more sets.
import type { Exercise, WorkoutEntry } from '../../supabase/types'
import type { TranslationTarget } from '../../translation'

export type RegionId =
  | 'chest' | 'back' | 'shoulders' | 'biceps' | 'triceps' | 'forearms'
  | 'abs' | 'glutes' | 'quads' | 'hamstrings' | 'calves' | 'adductors'
  | 'genitals'

export interface Region {
  id: RegionId
  zh: string
  en: string
  view: 'front' | 'back' | 'both'
}

// The 12 default regions, in a head→toe-ish order.
export const REGIONS: Region[] = [
  { id: 'chest',      zh: '胸',       en: 'Chest',      view: 'front' },
  { id: 'shoulders',  zh: '肩',       en: 'Shoulders',  view: 'both' },
  { id: 'back',       zh: '背',       en: 'Back',       view: 'back' },
  { id: 'biceps',     zh: '二头',     en: 'Biceps',     view: 'front' },
  { id: 'triceps',    zh: '三头',     en: 'Triceps',    view: 'back' },
  { id: 'forearms',   zh: '前臂',     en: 'Forearms',   view: 'both' },
  { id: 'abs',        zh: '腹',       en: 'Abs',        view: 'front' },
  { id: 'glutes',     zh: '臀',       en: 'Glutes',     view: 'back' },
  { id: 'quads',      zh: '股四头',   en: 'Quads',      view: 'front' },
  { id: 'hamstrings', zh: '腘绳',     en: 'Hamstrings', view: 'back' },
  { id: 'calves',     zh: '小腿',     en: 'Calves',     view: 'back' },
  { id: 'adductors',  zh: '内收',     en: 'Adductors',  view: 'front' },
]

// The 13th region — only shown when the adult option is enabled; lit pink by
// intimacy sessions (counted as "sets"). Kept out of REGIONS so it never leaks
// into the default UI.
export const GENITALS_REGION: Region = { id: 'genitals', zh: '生殖器', en: 'Pelvic', view: 'front' }

export function regionLabel(id: RegionId, lang: TranslationTarget): string {
  const r = [...REGIONS, GENITALS_REGION].find((x) => x.id === id)
  return r ? (lang === 'zh' ? r.zh : r.en) : id
}

// Default category → regions. Casual splits lump (legs → whole lower body);
// detailed users can drag to remap (stored in localStorage, see below).
export const DEFAULT_CATEGORY_REGIONS: Record<string, RegionId[]> = {
  chest: ['chest'],
  back: ['back'],
  shoulders: ['shoulders'],
  legs: ['glutes', 'quads', 'hamstrings', 'calves', 'adductors'],
  arms: ['biceps', 'triceps', 'forearms'],
  biceps: ['biceps', 'forearms'],
  triceps: ['triceps'],
  core: ['abs'],
  cardio: [],
  warmup: [],
  sports: [],
}

const LS = 'th.anatomy.map'

function loadOverrides(): Record<string, RegionId[]> {
  try {
    const raw = localStorage.getItem(LS)
    return raw ? (JSON.parse(raw) as Record<string, RegionId[]>) : {}
  } catch {
    return {}
  }
}

/** Regions a category lights up (localStorage override falls back to defaults). */
export function categoryRegions(catKey: string): RegionId[] {
  const ov = loadOverrides()
  return ov[catKey] ?? DEFAULT_CATEGORY_REGIONS[catKey] ?? []
}

export function setCategoryRegions(catKey: string, regions: RegionId[]): void {
  const ov = loadOverrides()
  ov[catKey] = regions
  localStorage.setItem(LS, JSON.stringify(ov))
}

/** Snapshot the mapping store; returns a fn that restores it (for undo). */
export function snapshotAnatomy(): () => void {
  const raw = localStorage.getItem(LS)
  return () => { if (raw == null) localStorage.removeItem(LS); else localStorage.setItem(LS, raw) }
}

export interface RegionActivity {
  sets: number
  items: Array<{ exId: string; sets: number; day: string | null }>
}

/**
 * Per-region set totals from logged entries. An exercise's regions = the union of
 * its categories' region maps (deduped, so multi-category lifts don't double-count
 * a shared region). `setCount(entryId)` returns that entry's working-set count.
 */
export function regionActivity(
  entries: WorkoutEntry[],
  setCount: (entryId: string) => number,
  exById: Record<string, Exercise>,
): Record<string, RegionActivity> {
  const out: Record<string, RegionActivity> = {}
  for (const e of entries) {
    const ex = exById[e.exercise_id]
    if (!ex) continue
    const regions = new Set<RegionId>()
    for (const cat of ex.body_parts) for (const r of categoryRegions(cat)) regions.add(r)
    if (regions.size === 0) continue
    const n = setCount(e.id)
    if (n <= 0) continue
    for (const r of regions) {
      const a = (out[r] ??= { sets: 0, items: [] })
      a.sets += n
      a.items.push({ exId: e.exercise_id, sets: n, day: e.cycle_day_label ?? null })
    }
  }
  return out
}
