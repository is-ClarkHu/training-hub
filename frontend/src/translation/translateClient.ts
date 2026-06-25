// Client for the /api/translate Supabase Edge Function (SPEC §5.5). The Claude
// API key lives in the function, never here — we only invoke it (supabase-js
// attaches the user's JWT so the function's writes are RLS-scoped).
import { supabase } from '../supabase/client'
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
  const { data, error } = await supabase.functions.invoke('translate', {
    body: { domain, text, target },
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data as TranslateResponse
}
