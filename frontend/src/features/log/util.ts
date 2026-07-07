import type { NewSetInput } from '../../db'
import type { ParsedNote, TranslationTarget } from '../../translation'
import type { BodyPart, Exercise, ExerciseSet, MeasureType, SetType, SubSet } from '../../supabase/types'

/** One sub-set's editable strings (weight×reps or duration). */
export interface SubDraft {
  weight: string
  reps: string
  duration: string // 'mm:ss' or seconds
}
export const emptySub = (): SubDraft => ({ weight: '', reps: '', duration: '' })

/** One editable SET in the Log form. `subs` has 1 row for a normal set, 2+ for a
 *  superset/dropset (each sub-set its own weight×reps). */
export interface SetDraft {
  subs: SubDraft[]
  per_side: boolean
  set_type: SetType
  note: string
}

export const emptySet = (): SetDraft => ({ subs: [emptySub()], per_side: false, set_type: 'normal', note: '' })

export function exerciseName(ex: Exercise, lang: TranslationTarget): string {
  const primary = lang === 'zh' ? ex.name_zh : ex.name_en
  return primary || ex.name_zh || ex.name_en // fall back only if a name is genuinely missing
}

const MEASURE_ORDER: Record<MeasureType, number> = { weight_reps: 0, reps_only: 1, duration: 2 }

function nameKey(ex: Exercise, lang: TranslationTarget): string {
  return exerciseName(ex, lang)
    .toLowerCase()
    .replace(/[()（）\[\]【】,，·/\\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Stable exercise ordering for pickers/managers: category → measure type → name. */
export function sortExercises(
  items: Exercise[],
  lang: TranslationTarget,
  categoryOrder: BodyPart[] = [],
): Exercise[] {
  const catRank = new Map(categoryOrder.map((k, i) => [k, i]))
  const collator = new Intl.Collator(lang === 'zh' ? 'zh-Hans-CN' : 'en', { numeric: true, sensitivity: 'base' })
  return [...items].sort((a, b) => {
    const ac = Math.min(...a.body_parts.map((bp) => catRank.get(bp) ?? 999))
    const bc = Math.min(...b.body_parts.map((bp) => catRank.get(bp) ?? 999))
    if (ac !== bc) return ac - bc
    const am = MEASURE_ORDER[a.measure_type]
    const bm = MEASURE_ORDER[b.measure_type]
    if (am !== bm) return am - bm
    return collator.compare(nameKey(a, lang), nameKey(b, lang))
  })
}

/** Parse 'mm:ss' (or bare seconds) → total seconds; '' → null. */
export function parseDuration(text: string): number | null {
  const t = text.trim()
  if (!t) return null
  if (t.includes(':')) {
    const [m, s] = t.split(':')
    const mins = parseInt(m, 10) || 0
    const secs = parseInt(s, 10) || 0
    return mins * 60 + secs
  }
  const n = parseInt(t, 10)
  return Number.isNaN(n) ? null : n
}

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Parse 'h:mm' or 'h.h' or bare hours → decimal hours; '' → null. */
export function parseHours(text: string): number | null {
  const t = text.trim()
  if (!t) return null
  if (t.includes(':')) {
    const [h, m] = t.split(':')
    const hh = parseInt(h, 10) || 0
    const mm = parseInt(m, 10) || 0
    return hh + mm / 60
  }
  const n = Number(t)
  return Number.isNaN(n) ? null : n
}

/** Decimal hours → 'h:mm'. */
export function formatHours(hours: number): string {
  const h = Math.floor(hours)
  const m = Math.round((hours - h) * 60)
  return `${h}:${String(m).padStart(2, '0')}`
}

export function toNumber(text: string): number | null {
  const t = text.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isNaN(n) ? null : n
}

export function toInt(text: string): number | null {
  const t = text.trim()
  if (!t) return null
  const n = parseInt(t, 10)
  return Number.isNaN(n) ? null : n
}

/** Parse one sub-draft → {weight,reps,duration_sec} for the given measure type,
 *  or null if it's empty. */
function subToValues(d: SubDraft, mt: MeasureType): SubSet | null {
  if (mt === 'weight_reps') {
    const w = toNumber(d.weight)
    const r = toInt(d.reps)
    if (w === null && r === null) return null
    return { weight: w, reps: r, duration_sec: null }
  }
  if (mt === 'reps_only') {
    const r = toInt(d.reps)
    if (r === null) return null
    return { weight: null, reps: r, duration_sec: null }
  }
  const s = parseDuration(d.duration)
  if (s === null) return null
  return { weight: null, reps: null, duration_sec: s }
}

/** Convert editable drafts → set rows. Each draft becomes ONE set; its extra
 *  sub-sets ride in `sub_sets`. Note semantics (§5.3) still apply per set. */
export function draftsToSetInputs(
  sets: SetDraft[],
  mt: MeasureType,
  parsed: ParsedNote,
): NewSetInput[] {
  const globalType: SetType = parsed.warmup ? 'warmup' : 'normal'
  const out: NewSetInput[] = []
  for (const d of sets) {
    const vals = d.subs.map((s) => subToValues(s, mt)).filter((v): v is SubSet => v !== null)
    if (vals.length === 0) continue
    const [primary, ...rest] = vals
    const perSide = d.per_side || (parsed.perSide && mt !== 'duration')
    out.push({
      weight: primary.weight,
      reps: primary.reps,
      duration_sec: primary.duration_sec,
      per_side: perSide,
      sub_sets: rest,
      set_type: d.set_type !== 'normal' ? d.set_type : globalType,
      ...(d.note.trim() ? { note: d.note.trim() } : {}),
    })
  }
  return out
}

/** Existing set row → editable draft (for History edit mode). */
export function setToDraft(s: ExerciseSet): SetDraft {
  const primary: SubDraft = {
    weight: s.weight != null ? String(s.weight) : '',
    reps: s.reps != null ? String(s.reps) : '',
    duration: s.duration_sec != null ? formatDuration(s.duration_sec) : '',
  }
  const rest: SubDraft[] = (s.sub_sets ?? []).map((ss) => ({
    weight: ss.weight != null ? String(ss.weight) : '',
    reps: ss.reps != null ? String(ss.reps) : '',
    duration: ss.duration_sec != null ? formatDuration(ss.duration_sec) : '',
  }))
  return { subs: [primary, ...rest], per_side: s.per_side, set_type: s.set_type, note: s.note ?? '' }
}

function fmtSub(v: { weight: number | null; reps: number | null; duration_sec: number | null }, mt: MeasureType): string {
  if (mt === 'duration') return v.duration_sec != null ? formatDuration(v.duration_sec) : '–'
  if (mt === 'reps_only') return `${v.reps ?? '–'}`
  return `${v.weight ?? '–'}×${v.reps ?? '–'}`
}

/** One-line summary of a set — sub-sets joined by '+' (e.g. "25×13 + 20×13"). */
export function formatSet(s: ExerciseSet, mt: MeasureType): string {
  const parts = [fmtSub(s, mt), ...(s.sub_sets ?? []).map((v) => fmtSub(v, mt))]
  return parts.join(' + ') + (s.per_side ? '/side' : '')
}
