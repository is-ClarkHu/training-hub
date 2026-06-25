/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL (browser-safe). */
  readonly VITE_SUPABASE_URL: string
  /** Supabase anon key — browser-safe by design; RLS enforces per-user isolation. */
  readonly VITE_SUPABASE_ANON_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
