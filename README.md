# training-hub

Offline-first, bilingual (中 / EN) PWA for strength & frisbee training — per-set
logging, progression analytics, injury & rehab tracking, training cycles, and a
memory-aware, multi-chatroom **AI coach**. Local-first (Dexie/IndexedDB) with
Supabase for sync / auth / storage; a small FastAPI backend relays LLM calls so API
keys stay in the browser. Bilingual down to the **data**, not just the UI.

## Features

- **Log / History / Dashboard** — per-set logging (supersets, note tags), reverse-
  chron history, and bilingual charts (intensity heatmap, progression, distributions).
- **Sports** — user-creatable sport/activity library with session logging and
  per-sport mini-charts.
- **Injuries** — injury-as-event log with a rehab library, plan and symptom timeline.
- **Cycle** — training-loop editor with per-muscle recovery spacing.
- **Bilingual (中/EN) data** — not just labels: exercise/sport names are translated
  and cached via an AI dictionary (Supabase Edge Function), with a manual override.
- **Offline-first PWA** — Dexie/IndexedDB is the instant source of truth; a background
  SyncEngine reconciles with Supabase (last-write-wins). Installable, works offline.
- **AI assistant** — multiple chatrooms, each with:
  - a **permission matrix** deciding which of your data it may read (enforced backend-
    side at read time, not just in the UI);
  - **rolling memory** + savable memory units + opt-in **cross-room** memory sharing;
  - a **per-room model** (DeepSeek / OpenAI / Anthropic / Gemini / …);
  - pre-fillable **data modules**: basics & measurement trends, food (with photo
    recognition), supplements, training environment, notes, medical background, and
    uploaded reference files (summarized for context).
  - Sensitivity tiers: medical is high-sensitivity (opt-in per room); the intimacy
    tracker is **hard-isolated** and never reaches the AI.

## Quick start

Bring your own Supabase project and your own LLM API keys (kept in the browser, never
on the server). Full walkthrough — including auth and the assistant backend — in
**[SETUP.md](SETUP.md)**.

```bash
# 1. Supabase: create a project, then apply every file in
#    supabase/migrations/ in filename order (dashboard SQL editor, or `supabase db push`),
#    and create your login account (Authentication → Users).

# 2. Frontend
cd frontend
cp .env.example .env.local     # fill VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm install && npm run dev     # http://localhost:5174

# 3. (optional) AI assistant backend
cd ../backend
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
cp .env.example .env           # fill SUPABASE_URL + SUPABASE_KEY (anon)
./.venv/bin/uvicorn app.main:app --port 8000
```

Then log in, and add an LLM API key under **Settings → AI** to use the assistant.

## Multi-user

Every table is row-level-security scoped to `user_id = auth.uid()`, so **one Supabase
project can host many accounts** with each user's data fully isolated — no schema
change needed. Accounts are invite-only by default (the owner creates them in Supabase
Auth); flip Supabase's sign-up setting to allow self-serve registration. One backend
serves all users (it scopes every read via the caller's JWT), and each user configures
their own LLM keys in Settings → AI.

## Structure

```
training-hub/
├── frontend/          React + Vite + TS PWA (see frontend/src/README.md)
├── supabase/
│   ├── migrations/    SQL schema + RLS policies — source of truth (see its README)
│   └── functions/     Edge Function for /api/translate
├── backend/           FastAPI relay: /api/assistant, /api/translate, food vision, file summary
├── migration/         one-time legacy CSV → app importer (personal, optional)
├── docs/              design docs — GITIGNORED (private)
└── raw_data/          personal legacy data, read-only — GITIGNORED
```

## Privacy

No credentials or API keys are committed. All `.env*` files, `docs/`, `raw_data/`,
and virtualenvs are gitignored; LLM keys are provided at runtime and live only in the
user's browser. The Supabase anon key is browser-safe (`VITE_`-exposed) by design.

## License

See [LICENSE](LICENSE).
