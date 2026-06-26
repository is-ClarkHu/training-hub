// Canonical note tags (SPEC §5.3). Notes mix free text with structured intent
// ("每侧"=per-side, "热身"=warmup, …). On save we parse note_raw for known
// fragments → fill note_tags[] (rendered bilingually, filterable) and map the
// data-affecting ones onto structured set fields (per_side, set_type=warmup).
import type { SetType } from '../supabase/types'
import type { TranslationTarget } from './dictionary'

export interface NoteTag {
  key: string
  zh: string
  en: string
  aliases: string[]       // zh fragments that match this tag
  perSide?: boolean       // sets per_side=true
  setType?: SetType       // overrides set_type
}

export const CANONICAL_NOTE_TAGS: NoteTag[] = [
  { key: 'per_side', zh: '每侧', en: 'per side', aliases: ['每侧', '两边各', '每边'], perSide: true },
  { key: 'warmup', zh: '热身', en: 'warmup', aliases: ['热身'], setType: 'warmup' },
  { key: 'to_failure', zh: '力竭', en: 'to failure', aliases: ['力竭'] },
  { key: 'fast', zh: '快速', en: 'explosive', aliases: ['快速', '爆发'] },
  { key: 'rehab', zh: '康复', en: 'rehab', aliases: ['康复', '恢复'] },
  { key: 'activation', zh: '激活', en: 'activation', aliases: ['激活'] },
]

export interface ParsedNote {
  tagKeys: string[]
  perSide: boolean
  warmup: boolean
}

/** Scan note_raw for known tag fragments (never mutates the original text). */
export function parseNote(noteRaw: string): ParsedNote {
  const tagKeys: string[] = []
  let perSide = false
  let warmup = false
  for (const tag of CANONICAL_NOTE_TAGS) {
    if (tag.aliases.some((a) => noteRaw.includes(a))) {
      tagKeys.push(tag.key)
      if (tag.perSide) perSide = true
      if (tag.setType === 'warmup') warmup = true
    }
  }
  return { tagKeys, perSide, warmup }
}

export function noteTagLabel(key: string, lang: TranslationTarget): string {
  const tag = CANONICAL_NOTE_TAGS.find((t) => t.key === key)
  if (!tag) return key
  return lang === 'zh' ? tag.zh : tag.en
}
