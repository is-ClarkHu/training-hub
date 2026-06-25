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
import { requestTranslation } from './translateClient'

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
  name_en: string
  body_part: BodyPart | null
  measure_type: MeasureType | null
  source: TranslationSource | 'pending'
  needsTranslation: boolean
}

/**
 * Add-new-exercise helper (§7.1): given a Chinese exercise name, propose the
 * English name + body_part + measure_type for the user to confirm.
 */
export async function suggestExercise(nameZh: string): Promise<ExerciseSuggestion> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { name_en: '', body_part: null, measure_type: null, source: 'pending', needsTranslation: true }
  }
  try {
    const res = await requestTranslation('exercise', nameZh, 'en')
    if (res.row) await cacheRow(res.row)
    return {
      name_en: res.text,
      body_part: res.suggested_body_part,
      measure_type: res.suggested_measure_type,
      source: res.source,
      needsTranslation: false,
    }
  } catch {
    return { name_en: '', body_part: null, measure_type: null, source: 'pending', needsTranslation: true }
  }
}
