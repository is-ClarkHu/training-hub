// resolve() — the three-tier translation resolver (SPEC §5.1):
//   1. local dictionary cache hit  → return it
//   2. miss + online               → call /api/translate, cache, return
//   3. miss + offline              → return the source as a temporary fallback,
//                                     flagged needsTranslation for later cleanup
//
// This is the single entry point every screen uses to render translatable DATA
// in the current language. Never show mixed-language text (§14): callers pass the
// stored source string and the target language, and get back text in that language.
import type { BodyPart, MeasureType, TranslationDomain, TranslationSource } from '../supabase/types'
import { lookup, cacheRow, type TranslationTarget } from './dictionary'
import { requestTranslation, translateFreeText } from './translateClient'

export interface ResolveResult {
  /** The term in the target language (or the source string as offline fallback). */
  text: string
  source: TranslationSource | 'pending'
  /** True when offline/failed — the value is a fallback to resolve later. */
  needsTranslation: boolean
}

export async function resolve(
  domain: TranslationDomain,
  source: string,
  target: TranslationTarget = 'en',
): Promise<ResolveResult> {
  if (!source) return { text: '', source: 'pending', needsTranslation: false }

  const hit = await lookup(domain, source, target)
  if (hit) {
    return { text: target === 'en' ? hit.en : hit.zh, source: hit.source, needsTranslation: false }
  }

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { text: source, source: 'pending', needsTranslation: true } // §5.1 step 3
  }

  try {
    const res = await requestTranslation(domain, source, target)
    if (res.row) await cacheRow(res.row)
    return { text: res.text, source: res.source, needsTranslation: false }
  } catch {
    return { text: source, source: 'pending', needsTranslation: true }
  }
}

export interface ExerciseSuggestion {
  name_zh: string
  name_en: string
  body_part: BodyPart | null
  measure_type: MeasureType | null
  source: TranslationSource | 'pending'
  needsTranslation: boolean
}

const HAS_CJK = /[一-鿿]/

/**
 * Add-new-exercise helper (§7.1): given an exercise name in Chinese OR English,
 * propose the other-language name + body_part + measure_type for the user to
 * confirm. Direction is inferred from whether the input contains Chinese.
 */
export async function suggestExercise(rawName: string): Promise<ExerciseSuggestion> {
  const name = rawName.trim()
  const inputIsZh = HAS_CJK.test(name)
  const target: TranslationTarget = inputIsZh ? 'en' : 'zh'

  const offline = typeof navigator !== 'undefined' && !navigator.onLine
  if (offline || !name) {
    return {
      name_zh: inputIsZh ? name : '',
      name_en: inputIsZh ? '' : name,
      body_part: null,
      measure_type: null,
      source: 'pending',
      needsTranslation: !!name,
    }
  }
  try {
    const res = await requestTranslation('exercise', name, target)
    if (res.row) await cacheRow(res.row)
    return {
      name_zh: inputIsZh ? name : res.text,
      name_en: inputIsZh ? res.text : name,
      body_part: res.suggested_body_part,
      measure_type: res.suggested_measure_type,
      source: res.source,
      needsTranslation: false,
    }
  } catch {
    return {
      name_zh: inputIsZh ? name : '',
      name_en: inputIsZh ? '' : name,
      body_part: null,
      measure_type: null,
      source: 'pending',
      needsTranslation: true,
    }
  }
}

export interface InjuryNoteSuggestion {
  note_zh: string
  note_en: string
  needsTranslation: boolean
}

/**
 * Injury-note helper (§6A): given a free-text note in Chinese OR English, produce
 * the bilingual pair. Direction is inferred from whether the input contains
 * Chinese. Offline / on failure, the typed side is kept and the other is left
 * blank (flagged needsTranslation) for later cleanup.
 */
export async function suggestInjuryNote(raw: string): Promise<InjuryNoteSuggestion> {
  const note = raw.trim()
  const inputIsZh = HAS_CJK.test(note)
  const target: TranslationTarget = inputIsZh ? 'en' : 'zh'
  const offline = typeof navigator !== 'undefined' && !navigator.onLine

  if (offline || !note) {
    return {
      note_zh: inputIsZh ? note : '',
      note_en: inputIsZh ? '' : note,
      needsTranslation: !!note,
    }
  }
  try {
    const other = await translateFreeText(note, target)
    return {
      note_zh: inputIsZh ? note : other,
      note_en: inputIsZh ? other : note,
      needsTranslation: false,
    }
  } catch {
    return {
      note_zh: inputIsZh ? note : '',
      note_en: inputIsZh ? '' : note,
      needsTranslation: true,
    }
  }
}
