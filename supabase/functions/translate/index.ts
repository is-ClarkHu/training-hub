// Supabase Edge Function: /api/translate (SPEC §5)
//
// Translates a fitness term zh⇄en using STANDARD gym terminology (not literal),
// caches the result into translation_dictionary (RLS-scoped to the caller), and
// returns the persisted row so every device can mirror it offline (§5.1).
//
// Runs on Deno. Secrets come from the function's env (never the browser):
//   ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY (auto-injected by Supabase).
//
// The model defaults to claude-opus-4-8. This is a high-volume, simple task — set
// TRANSLATE_MODEL=claude-haiku-4-5 in the function env to cut cost/latency if you
// prefer (your call; we don't downgrade silently).
import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'npm:@supabase/supabase-js@2'

const MODEL = Deno.env.get('TRANSLATE_MODEL') ?? 'claude-opus-4-8'

const BODY_PARTS = ['chest', 'back', 'shoulders', 'legs', 'arms', 'core', 'frisbee']
const MEASURE_TYPES = ['weight_reps', 'reps_only', 'duration']

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const DOMAIN_LABEL: Record<string, string> = {
  exercise: 'a strength-training exercise name',
  body_part: 'a body-part label',
  note_tag: 'a training-note fragment (e.g. per-side, warmup, to-failure)',
  sport: 'a sport / activity name',
}

function systemPrompt(domain: string, target: 'en' | 'zh'): string {
  const targetLang = target === 'en' ? 'English' : 'Chinese'
  return [
    `You are a professional bilingual (Chinese⇄English) strength-training and sports translator.`,
    `The input is ${DOMAIN_LABEL[domain] ?? 'a fitness term'}. Translate it into ${targetLang} using STANDARD, idiomatic gym/fitness terminology — never a literal word-for-word translation.`,
    `Examples: 牧师凳弯举 → "Preacher Curl" (NOT "priest bench curl"); 高位下拉 → "Lat Pulldown"; 反手 → "reverse-grip" / "supinated".`,
    `Return ONLY the translated term in the "translation" field — no commentary, no quotes.`,
    domain === 'exercise'
      ? `Also infer "suggested_body_part" (one of ${BODY_PARTS.join(', ')}) and "suggested_measure_type" (one of ${MEASURE_TYPES.join(', ')}) for the exercise.`
      : `Set "suggested_body_part" and "suggested_measure_type" to null (only exercises get those).`,
  ].join(' ')
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['translation', 'suggested_body_part', 'suggested_measure_type'],
  properties: {
    translation: { type: 'string' },
    suggested_body_part: {
      anyOf: [{ type: 'string', enum: BODY_PARTS }, { type: 'null' }],
    },
    suggested_measure_type: {
      anyOf: [{ type: 'string', enum: MEASURE_TYPES }, { type: 'null' }],
    },
  },
}

interface ClaudeResult {
  translation: string
  suggested_body_part: string | null
  suggested_measure_type: string | null
}

async function translateWithClaude(
  anthropic: Anthropic,
  domain: string,
  text: string,
  target: 'en' | 'zh',
): Promise<ClaudeResult> {
  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 256,
    system: systemPrompt(domain, target),
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: text }],
  })
  // Structured output arrives as a single text block containing the JSON.
  const block = resp.content.find((b) => b.type === 'text') as { text: string } | undefined
  if (!block) throw new Error('No text block in model response')
  return JSON.parse(block.text) as ClaudeResult
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  try {
    const { domain, text, target = 'en' } = await req.json()
    if (!domain || !text || !DOMAIN_LABEL[domain]) {
      return json({ error: 'Expected { domain, text, target? } with a known domain' }, 400)
    }
    if (target !== 'en' && target !== 'zh') {
      return json({ error: "target must be 'en' or 'zh'" }, 400)
    }

    // RLS-scoped client using the caller's JWT — inserts get user_id = auth.uid().
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
    )

    // Server-side cache: another device may already have translated this (§5.1).
    const sourceCol = target === 'en' ? 'zh' : 'en'
    const { data: existing } = await supabase
      .from('translation_dictionary')
      .select('*')
      .eq('domain', domain)
      .eq(sourceCol, text)
      .eq('deleted', false)
      .limit(1)
      .maybeSingle()

    if (existing) {
      return json({
        text: target === 'en' ? existing.en : existing.zh,
        suggested_body_part: null,
        suggested_measure_type: null,
        source: existing.source,
        row: existing,
      })
    }

    // Miss → ask Claude, then cache.
    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! })
    const result = await translateWithClaude(anthropic, domain, text, target)

    const zh = target === 'en' ? text : result.translation
    const en = target === 'en' ? result.translation : text

    let { data: row, error } = await supabase
      .from('translation_dictionary')
      .insert({ domain, zh, en, source: 'ai', verified: false })
      .select()
      .single()

    // Lost a race against another insert with the same (domain, zh) — re-read it.
    if (error) {
      const { data: raced } = await supabase
        .from('translation_dictionary')
        .select('*')
        .eq('domain', domain)
        .eq(sourceCol, text)
        .eq('deleted', false)
        .limit(1)
        .maybeSingle()
      row = raced ?? null
    }

    return json({
      text: result.translation,
      suggested_body_part: result.suggested_body_part,
      suggested_measure_type: result.suggested_measure_type,
      source: 'ai',
      row,
    })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
