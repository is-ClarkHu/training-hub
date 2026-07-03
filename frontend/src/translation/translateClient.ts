// Translation via a browser-direct LLM call (SPEC §5). The key + model come from
// Settings → AI; no backend is required. The result is cached into the local
// dictionary (a new row synced like anything else).
import { newId, nowIso } from '../db'
import { currentUserId } from '../supabase/client'
import { chatComplete, getKey, getTaskCfg } from '../ai'
import {
  BODY_PARTS,
  type BodyPart,
  type MeasureType,
  type TranslationDomain,
  type TranslationDictionaryRow,
  type TranslationSource,
} from '../supabase/types'
import type { TranslationTarget } from './dictionary'

export interface TranslateResponse {
  text: string
  suggested_body_part: BodyPart | null
  suggested_measure_type: MeasureType | null
  source: TranslationSource
  row: TranslationDictionaryRow | null
}

const MEASURE_TYPES: MeasureType[] = ['weight_reps', 'reps_only', 'duration']

const DOMAIN_LABEL: Record<TranslationDomain, string> = {
  exercise: 'a strength-training exercise name',
  body_part: 'a body-part label',
  note_tag: 'a training-note fragment',
  sport: 'a sport / activity name',
}

function prompt(domain: TranslationDomain, target: TranslationTarget): string {
  const langName = target === 'en' ? 'English' : 'Chinese'
  const infer =
    domain === 'exercise'
      ? `Also infer "suggested_body_part" (one of ${BODY_PARTS.join(', ')}) and "suggested_measure_type" (one of ${MEASURE_TYPES.join(', ')}).`
      : 'Set "suggested_body_part" and "suggested_measure_type" to null.'
  return (
    `You are a bilingual (Chinese⇄English) strength & sports translator. The input is ${DOMAIN_LABEL[domain]}. ` +
    `Translate it into ${langName} using STANDARD gym terminology, never literal ` +
    `(e.g. 牧师凳弯举→Preacher Curl, 高位下拉→Lat Pulldown). ${infer} ` +
    `Respond with ONLY a JSON object: {"translation":"...","suggested_body_part":...,"suggested_measure_type":...}`
  )
}

function parseJson(reply: string): { translation?: string; suggested_body_part?: unknown; suggested_measure_type?: unknown } {
  const m = reply.match(/\{[\s\S]*\}/)
  if (!m) return { translation: reply.trim() }
  try {
    return JSON.parse(m[0])
  } catch {
    return { translation: reply.trim() }
  }
}

export async function requestTranslation(
  domain: TranslationDomain,
  text: string,
  target: TranslationTarget,
): Promise<TranslateResponse> {
  const cfg = getTaskCfg('translation')
  const reply = await chatComplete(cfg.provider, cfg.model, getKey(cfg.provider), prompt(domain, target), text, 256)
  const parsed = parseJson(reply)

  const translation = (parsed.translation ? String(parsed.translation) : reply).trim()
  const bp = BODY_PARTS.includes(parsed.suggested_body_part as BodyPart) ? (parsed.suggested_body_part as BodyPart) : null
  const mt = MEASURE_TYPES.includes(parsed.suggested_measure_type as MeasureType) ? (parsed.suggested_measure_type as MeasureType) : null

  const zh = target === 'en' ? text : translation
  const en = target === 'en' ? translation : text
  const row: TranslationDictionaryRow = {
    id: newId(),
    user_id: currentUserId() ?? '',
    domain,
    zh,
    en,
    source: 'ai',
    verified: false,
    updated_at: nowIso(),
    deleted: false,
  }
  return { text: translation, suggested_body_part: bp, suggested_measure_type: mt, source: 'ai', row }
}
