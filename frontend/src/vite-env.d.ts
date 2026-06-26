/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL (browser-safe). */
  readonly VITE_SUPABASE_URL: string
  /** Supabase anon key — browser-safe by design; RLS enforces per-user isolation. */
  readonly VITE_SUPABASE_ANON_KEY: string
  /** Phase-2 assistant backend base URL (defaults to http://localhost:8000). */
  readonly VITE_ASSISTANT_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
