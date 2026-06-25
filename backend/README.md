# backend — PHASE 2 ONLY

This minimal FastAPI is **not built in Phase 1**. It exists solely so the Claude
API key never ships to the browser (SPEC §9, §11). Phase 1 keeps this directory
as a placeholder.

When Phase 2 starts:
- `app/main.py` — FastAPI with a single `/api/assistant` route.
- `app/memory.py` — `build_memory_context()` (reads from Supabase, per-user).
- Secrets in `.env` (see `.env.example`), never committed.

Translation (`/api/translate`, SPEC §5) is implemented as a **Supabase Edge
Function** (`../supabase/functions/translate`), not here — so Phase 1 needs no
Python backend at all.
