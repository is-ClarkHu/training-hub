// Client for the /api/translate backend relay (SPEC §5). Sends the user's Supabase
// JWT (RLS-scoped caching) + the chosen provider/model/key (Settings → AI). The
// backend calls the LLM and caches the pair into translation_dictionary.
import { supabase } from '../supabase/client'
import { aiPayload, backendUrl } from '../ai/config'
import type {
  BodyPart,
  MeasureType,
  TranslationDomain,
  TranslationDictionaryRow,
  TranslationSource,
} from '../supabase/types'
import type { TranslationTarget } from './dictionary'

export interface TranslateResponse {
  text: string
  suggested_body_part: BodyPart | null
  suggested_measure_type: MeasureType | null
  source: TranslationSource
  row: TranslationDictionaryRow | null
}

export async function requestTranslation(
  domain: TranslationDomain,
  text: string,
  target: TranslationTarget,
): Promise<TranslateResponse> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Not signed in')

  const res = await fetch(`${backendUrl()}/api/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ domain, text, target, ...aiPayload('translation') }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`translate ${res.status}${detail ? `: ${detail}` : ''}`)
  }
  return (await res.json()) as TranslateResponse
}
