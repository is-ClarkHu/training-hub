import type { NewSetInput } from '../../db'
import type { ParsedNote, TranslationTarget } from '../../translation'
import type { Exercise, ExerciseSet, MeasureType, SetType } from '../../supabase/types'

/** One editable set row in the Log form (strings; parsed on save). */
export interface SetDraft {
  weight: string
  reps: string
  duration: string // 'mm:ss' or seconds
  per_side: boolean
  set_type: SetType
  note: string
}

export const emptySet = (): SetDraft => ({ weight: '', reps: '', duration: '', per_side: false, set_type: 'normal', note: '' })

export function exerciseName(ex: Exercise, lang: TranslationTarget): string {
  const primary = lang === 'zh' ? ex.name_zh : ex.name_en
  return primary || ex.name_zh || ex.name_en // fall back only if a name is genuinely missing
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

/** Convert editable drafts → set rows, applying note semantics (§5.3) + superset. */
export function draftsToSetInputs(
  sets: SetDraft[],
  mt: MeasureType,
  parsed: ParsedNote,
): NewSetInput[] {
  // Set type is per-set now (§ superset/dropset are single sets, not the whole
  // exercise). A note-parsed warmup only fills sets left as 'normal'.
  const globalType: SetType = parsed.warmup ? 'warmup' : 'normal'
  const out: NewSetInput[] = []
  for (const d of sets) {
    let row: NewSetInput | null = null
    if (mt === 'weight_reps') {
      const w = toNumber(d.weight)
      const r = toInt(d.reps)
      if (w !== null || r !== null) row = { weight: w, reps: r, per_side: d.per_side }
    } else if (mt === 'reps_only') {
      const r = toInt(d.reps)
      if (r !== null) row = { reps: r, per_side: d.per_side }
    } else {
      const s = parseDuration(d.duration)
      if (s !== null) row = { duration_sec: s }
    }
    if (!row) continue
    if (parsed.perSide && mt !== 'duration') row.per_side = true
    // per-set type wins; otherwise fall back to the entry-level warmup/superset
    row.set_type = d.set_type !== 'normal' ? d.set_type : globalType
    if (d.note.trim()) row.note = d.note.trim()
    out.push(row)
  }
  return out
}

/** Existing set row → editable draft (for History edit mode). */
export function setToDraft(s: ExerciseSet): SetDraft {
  return {
    weight: s.weight != null ? String(s.weight) : '',
    reps: s.reps != null ? String(s.reps) : '',
    duration: s.duration_sec != null ? formatDuration(s.duration_sec) : '',
    per_side: s.per_side,
    set_type: s.set_type,
    note: s.note ?? '',
  }
}

/** One-line bilingual-agnostic summary of a set (numbers only). */
export function formatSet(s: ExerciseSet, mt: MeasureType): string {
  if (mt === 'duration') return s.duration_sec != null ? formatDuration(s.duration_sec) : '–'
  if (mt === 'reps_only') return `${s.reps ?? '–'}${s.per_side ? '/side' : ''}`
  return `${s.weight ?? '–'}×${s.reps ?? '–'}${s.per_side ? '/side' : ''}`
}
