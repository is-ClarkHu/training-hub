// Client for the /api/assistant backend relay (SPEC §9). Sends the user's Supabase
// access token + the chosen provider/model/key (Settings → AI).
import { supabase } from '../../supabase/client'
import { aiPayload, backendUrl } from '../../ai/config'

export async function askAssistant(message: string): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Not signed in')

  const res = await fetch(`${backendUrl()}/api/assistant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message, ...aiPayload('assistant') }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Assistant error ${res.status}${detail ? `: ${detail}` : ''}`)
  }
  const json = (await res.json()) as { reply: string }
  return json.reply
}
