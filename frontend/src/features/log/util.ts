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

/** Insert the ':' automatically while typing: digits only, last two = the small
 *  unit. "130" → "1:30", "1305" → "13:05". Unit-agnostic (works for mm:ss & hh:mm). */
export function maskTime(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 6)
  if (d.length <= 2) return d
  return `${d.slice(0, -2)}:${d.slice(-2)}`
}

/** Parse 'a:b' (or bare) → total seconds. hm=false → mm:ss; hm=true → hh:mm.
 *  A bare number is seconds (mm:ss) or minutes (hh:mm). '' → null. */
export function parseDuration(text: string, hm = false): number | null {
  const t = text.trim()
  if (!t) return null
  if (t.includes(':')) {
    const [a, b] = t.split(':')
    const big = parseInt(a, 10) || 0
    const small = parseInt(b, 10) || 0
    return hm ? big * 3600 + small * 60 : big * 60 + small
  }
  const n = parseInt(t, 10)
  if (Number.isNaN(n)) return null
  return hm ? n * 60 : n
}

export function formatDuration(sec: number, hm = false): string {
  if (hm) {
    const h = Math.floor(sec / 3600)
    const m = Math.round((sec % 3600) / 60)
    return `${h}:${String(m).padStart(2, '0')}`
  }
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
function subToValues(d: SubDraft, mt: MeasureType, hm = false): SubSet | null {
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
  const s = parseDuration(d.duration, hm)
  if (s === null) return null
  return { weight: null, reps: null, duration_sec: s }
}

/** Convert editable drafts → set rows. Each draft becomes ONE set; its extra
 *  sub-sets ride in `sub_sets`. Note semantics (§5.3) still apply per set. */
export function draftsToSetInputs(
  sets: SetDraft[],
  mt: MeasureType,
  parsed: ParsedNote,
  hm = false,
): NewSetInput[] {
  const globalType: SetType = parsed.warmup ? 'warmup' : 'normal'
  const out: NewSetInput[] = []
  for (const d of sets) {
    const vals = d.subs.map((s) => subToValues(s, mt, hm)).filter((v): v is SubSet => v !== null)
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
export function setToDraft(s: ExerciseSet, hm = false): SetDraft {
  const primary: SubDraft = {
    weight: s.weight != null ? String(s.weight) : '',
    reps: s.reps != null ? String(s.reps) : '',
    duration: s.duration_sec != null ? formatDuration(s.duration_sec, hm) : '',
  }
  const rest: SubDraft[] = (s.sub_sets ?? []).map((ss) => ({
    weight: ss.weight != null ? String(ss.weight) : '',
    reps: ss.reps != null ? String(ss.reps) : '',
    duration: ss.duration_sec != null ? formatDuration(ss.duration_sec, hm) : '',
  }))
  return { subs: [primary, ...rest], per_side: s.per_side, set_type: s.set_type, note: s.note ?? '' }
}

function fmtSub(v: { weight: number | null; reps: number | null; duration_sec: number | null }, mt: MeasureType, hm = false): string {
  if (mt === 'duration') return v.duration_sec != null ? formatDuration(v.duration_sec, hm) : '–'
  if (mt === 'reps_only') return `${v.reps ?? '–'}`
  return `${v.weight ?? '–'}×${v.reps ?? '–'}`
}

/** One-line summary of a set — sub-sets joined by '+' (e.g. "25×13 + 20×13"). */
export function formatSet(s: ExerciseSet, mt: MeasureType, hm = false): string {
  const parts = [fmtSub(s, mt, hm), ...(s.sub_sets ?? []).map((v) => fmtSub(v, mt, hm))]
  return parts.join(' + ') + (s.per_side ? '/side' : '')
}
