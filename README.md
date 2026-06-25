# training-hub

Offline-first PWA for strength & frisbee logging with progression analytics and a
memory-aware AI assistant. React + Vite + TypeScript frontend (local-first via
Dexie/IndexedDB), Supabase for sync/auth/storage, a Phase-2-only minimal FastAPI
for the AI endpoint. Fully bilingual (zh ⇄ en) — including **data**, not just UI.

> This repo is **private**. `SPEC.md` (the build brief) and `raw_data/` (legacy
> source data) are **gitignored** and never committed — they stay local only.

## Structure

```
training-hub/
├── frontend/          React + Vite + TS PWA (see frontend/src/README.md)
├── supabase/
│   ├── migrations/    SQL schema + RLS policies (source of truth, §4)
│   └── functions/     Edge Function for /api/translate (§5)
├── backend/           MINIMAL · Phase 2 only — /api/assistant (§9)
├── migration/         legacy CSV → new schema; output to migration/out/ (§10)
├── docs/SPEC.md       build brief — GITIGNORED
└── raw_data/          user-provided legacy data, read-only — GITIGNORED
```

## Getting started (Phase 1, frontend)

```bash
cd frontend
cp .env.example .env.local   # fill VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

Build order and module responsibilities are defined in the spec (§11, §12).
