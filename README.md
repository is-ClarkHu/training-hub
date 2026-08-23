# training-hub

A bilingual (中 / EN) training PWA — per-set strength logging, progression
analytics, injury & rehab tracking, training cycles, and a memory-aware,
multi-chatroom **AI coach**. Backed by Supabase (Postgres / Auth / Storage / RLS),
with a small FastAPI relay for the LLM-powered features. Bilingual down to the
**data**, not just the UI.

The client keeps a local Dexie/IndexedDB cache as its working copy, so the UI is
instant and survives a flaky connection, then syncs to Supabase in the background —
but this is an online, cloud-synced app: sign-in, sync, and every AI feature need
the network.

## Live demo

Try it with the read-only-ish demo account — **re-seeded automatically every day**, so
every screen is populated (15 weeks of training with PRs, an in-progress cycle, 4 injury
recovery stories, a food log with AI nutrition estimates, 3 AI chatrooms with different
data permissions, and more):

- **URL:** `https://is-clarkhu.github.io/training-hub/`
- **Email:** `demo@training-hub.app` · **Password:** `demo-training-hub`

> The account resets nightly, so feel free to poke around — any edits are wiped on the
> next daily seed. (Replace the address/credentials above with your own.) The AI chat's
> live replies need an LLM key in Settings → AI, but the seeded transcripts, memory,
> summaries, and per-room permissions are all viewable without one. How it's built:
> [`frontend/scripts/seed-demo/`](frontend/scripts/seed-demo/README.md).

## Features

- **Log / History / Dashboard** — per-set logging (supersets, note tags), reverse-
  chron history, and bilingual charts (intensity heatmap, progression, distributions).
- **Sports** — user-creatable sport/activity library with session logging and
  per-sport mini-charts.
- **Injuries** — injury-as-event log with a rehab library, plan and symptom timeline.
- **Cycle** — training-loop editor with per-muscle recovery spacing.
- **Bilingual (中/EN) data** — not just labels: exercise / sport names are translated
  and cached in a local dictionary via a browser-direct AI call (your key, no backend),
  with a manual override.
- **Cloud sync + installable PWA** — Supabase is the source of truth; a background
  SyncEngine reconciles the local cache (last-write-wins). Installable to the home
  screen.
- **AI assistant** — multiple chatrooms, each with:
  - a **permission matrix** deciding which of your data it may read (enforced backend-
    side at read time, not just in the UI);
  - **rolling memory** + savable memory units + opt-in **cross-room** memory sharing;
  - a **per-room model** (DeepSeek / OpenAI / Anthropic / Gemini / …);
  - pre-fillable **data modules** with typed inputs and full add / edit / search:
    basics & measurement trends, food (photo recognition **+ calorie / macro
    estimate**), supplements, training environment, notes, medical background, and
    uploaded reference files (summarized for context).
  - Sensitivity tiers: medical is high-sensitivity (opt-in per room); the intimacy
    tracker is **hard-isolated** and never reaches the AI.

## Quick start

Bring your own Supabase project and your own LLM API keys — the backend sends them
only with the active request and never logs or persists them. Full walkthrough —
including auth and the assistant backend — in **[SETUP.md](SETUP.md)**.

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
Point the frontend at a deployed relay with `VITE_ASSISTANT_API_URL`; without it, the
AI features that need the backend are disabled off non-localhost origins (they show an
explanatory notice instead of failing).

## What needs the backend

The relay is only for LLM calls that must run server-side. Everything else — logging,
History, Cycle, Injuries, Dashboard, export, Supabase sync, the installable PWA — runs
on the static frontend + Supabase alone.

| Feature | Path | Needs relay? |
| --- | --- | --- |
| AI chat | `/api/assistant` | **Yes** — reads your data and enforces the per-room permission matrix server-side |
| Food photo → recognition + nutrition | `/api/describe-food` | **Yes** (vision) |
| Reference-file summary | `/api/summarize-file` | **Yes** |
| Translation dictionary | — | **No** — runs browser-direct from Settings → AI (touches no user data) |

`/api/translate` and `supabase/functions/translate` are legacy — translation moved
browser-direct and no longer calls them.

## Deployment

- **Frontend** → static host (e.g. GitHub Pages). `.github/workflows/deploy.yml` builds
  on push to `main`; set `BASE_PATH` for a project-path host and the `VITE_*` secrets
  (Supabase URL / anon key, and `VITE_ASSISTANT_API_URL` for the relay).
- **Backend** → any container/PaaS. `render.yaml` is a Render blueprint (free tier
  sleeps when idle, ~1 min cold start — the UI shows a "waking up" hint). Set
  `SUPABASE_URL` / `SUPABASE_KEY` (anon) and `FRONTEND_ORIGIN` for CORS.

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
├── backend/           FastAPI relay: /api/assistant, /api/describe-food, /api/summarize-file
├── supabase/
│   ├── migrations/    SQL schema + RLS policies — source of truth (see its README)
│   └── functions/     translate — legacy Edge Function (translation now runs browser-direct)
├── migration/         one-time legacy CSV → app importer (personal, optional)
├── render.yaml        Render blueprint for the backend relay
├── docs/              design docs — GITIGNORED (private)
└── raw_data/          personal legacy data, read-only — GITIGNORED
```

## Privacy

No credentials or API keys are committed. All `.env*` files, `docs/`, `raw_data/`,
`data/`, and virtualenvs are gitignored. User-supplied API keys are sent only with the
active request and are never logged or persisted by the backend. The Supabase anon key
is browser-safe (`VITE_`-exposed) by design.

## License

See [LICENSE](LICENSE).
