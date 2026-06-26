// Client for the Phase-2 assistant backend (SPEC §9). Sends the user's Supabase
// access token; the backend verifies it and scopes the memory context to the user.
import { supabase } from '../../supabase/client'

const BASE = import.meta.env.VITE_ASSISTANT_API_URL ?? 'http://localhost:8000'

export async function askAssistant(message: string): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Not signed in')

  const res = await fetch(`${BASE}/api/assistant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Assistant error ${res.status}${detail ? `: ${detail}` : ''}`)
  }
  const json = (await res.json()) as { reply: string }
  return json.reply
}
