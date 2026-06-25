// supabase-js client (SPEC §3). The frontend talks to Supabase directly; RLS
// scopes every query to the logged-in user. Only the browser-safe anon key is used.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // Fail loud in dev so a missing .env.local is obvious (see frontend/.env.example).
  throw new Error(
    'Missing Supabase env. Copy frontend/.env.example to .env.local and set ' +
      'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
  )
}

export const supabase: SupabaseClient = createClient(url, anonKey, {
  auth: {
    persistSession: true,    // single-user convenience: stay logged in (§3)
    autoRefreshToken: true,
  },
})
