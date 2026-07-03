// Browser-direct LLM call (no backend needed). The key from Settings → AI is used
// straight from the browser. Anthropic needs an explicit browser-access header;
// Gemini and OpenAI-compatible providers are called directly. Note: some
// OpenAI-compatible providers may block browser CORS — if so, pick Anthropic or
// Gemini for that task (they allow browser calls), or run the backend relay.
import type { AiProvider } from './config'

const OPENAI_COMPAT: Partial<Record<AiProvider, string>> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  moonshot: 'https://api.moonshot.cn/v1',
  mistral: 'https://api.mistral.ai/v1',
}

async function readError(r: Response, provider: string): Promise<string> {
  const body = await r.text().catch(() => '')
  return `${provider} ${r.status}${body ? `: ${body.slice(0, 200)}` : ''}`
}

export async function chatComplete(
  provider: AiProvider,
  model: string,
  apiKey: string,
  system: string,
  user: string,
  maxTokens = 512,
): Promise<string> {
  if (!apiKey) throw new Error(`No API key for ${provider} — set one in Settings → AI`)

  try {
    if (provider === 'anthropic') {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: model || 'claude-opus-4-8',
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content: user }],
        }),
      })
      if (!r.ok) throw new Error(await readError(r, 'anthropic'))
      const j = await r.json()
      return (j.content ?? []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('').trim()
    }

    if (provider === 'gemini') {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-2.0-flash'}:generateContent?key=${encodeURIComponent(apiKey)}`
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ parts: [{ text: user }] }],
          generationConfig: { maxOutputTokens: maxTokens },
        }),
      })
      if (!r.ok) throw new Error(await readError(r, 'gemini'))
      const j = await r.json()
      return (j.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim()
    }

    const base = OPENAI_COMPAT[provider]
    if (!base) throw new Error(`Unknown provider ${provider}`)
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    })
    if (!r.ok) throw new Error(await readError(r, provider))
    const j = await r.json()
    return (j.choices?.[0]?.message?.content ?? '').trim()
  } catch (e) {
    // A CORS/network rejection surfaces as a TypeError ("Failed to fetch").
    if (e instanceof TypeError) {
      throw new Error(
        `${provider} 无法从浏览器直连(可能是 CORS)。翻译请在 Settings → AI 选 Gemini 或 Anthropic(可浏览器直连),或改用后端。`,
      )
    }
    throw e
  }
}
