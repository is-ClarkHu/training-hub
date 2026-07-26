# training-hub — setup & run

Everything in the repo is built; these steps connect it to **your** Supabase
project and (optionally) run the AI assistant backend. The credential/account steps
(marked 🔑) can only be done by you — they require logging into your accounts.

## Prerequisites
- Node 20+ (you have 22), and Python 3.11+ if you run the optional assistant backend.
- A Supabase account, and an LLM API key from any supported provider (DeepSeek /
  OpenAI / Anthropic / Gemini / Moonshot / Mistral) for translation + the assistant.
  Keys are entered in the app (Settings → AI) and stay in your browser.

---

## 1. Supabase project 🔑
1. Create a project at supabase.com → copy the **Project URL** and **anon key**
   (Settings → API).
2. **Apply the schema + migrations, in filename order.** Easiest: Supabase
   dashboard → SQL Editor → paste each file's contents → Run, one at a time, top
   to bottom. (Or with the CLI: `supabase link` then `supabase db push` applies
   them all in order automatically.) Full index: `supabase/migrations/README.md`.

   **Core schema & training modules:**
   1. `20260624120000_init_schema.sql` — base schema (+ empty `chat_messages`/`insights`)
   2. `20260706120000_injury_v2.sql` — injuries as events (7-stage status, bilingual area/note, laterality/type/scenario, checkpoints, attachments)
   3. `20260706130000_rehab_library.sql` — rehab-exercise fields on `exercises`
   4. `20260706140000_rehab_loop.sql` — per-injury rehab plan + symptom assessments
   5. `20260706150000_injury_photos_storage.sql` — private `injury-photos` Storage bucket + RLS (needed before injury photos can upload/view)
   6. `20260706160000_exercise_multi_category.sql` — `body_part` → `body_parts[]`
   7. `20260707120000_cycle_rounds.sql` — training-cycle rounds
   8. `20260707130000_cycle_display_mode.sql` — cycle display mode
   9. `20260709120000_entry_module_part.sql` — per-occurrence module/part override
   10. `20260709130000_set_cardio_metrics.sql` — cardio metrics on sets
   11. `20260709140000_sport_metrics.sql` — sport metrics
   12. `20260710120000_entry_sort_order.sql` — entry sort order

   **AI multi-chatroom, permissions & memory** (see `docs/PLAN-ai-chatrooms.md`):
   13. `20260710130000_chatrooms.sql` — `chatrooms` + per-room `perms` matrix
   14. `20260710140000_chat_messages_chatroom.sql` — `chat_messages.chatroom_id` + backfill default room
   15. `20260710150000_chatroom_memory.sql` — rolling summaries, memory units, cross-room access grants
   16. `20260710160000_profile_modules.sql` — basics, body_measurements, notes, supplements, training_env, medical_background
   17. `20260710170000_food_and_files.sql` — food_log, public_files, chatroom_file_access + `food-photos` & `public-files` Storage buckets
   18. `20260711120000_chatroom_ai.sql` — per-room AI provider/model override

   **Cycle ↔ entry assignment:**
   19. `20260715180000_cycle_entry_assignment.sql` — assign an entry to a cycle round
   20. `20260718120000_entry_cycle_assignments.sql` — many-to-many entry↔cycle assignments

3. **Auth** (Authentication → Providers → Email): enable Email; turn **off**
   "Allow new users to sign up". Create your single account under
   Authentication → Users → Add user (email + password).

> **Injury photos** are compressed client-side (≤1600px JPEG), uploaded to the
> private `injury-photos` bucket (one folder per user, RLS-isolated), and cached
> locally. Medical imaging is intentionally unsupported. Migration 5 above must be
> run or photo upload will fail.
>
> Full feature walkthrough: **`docs/injury-module.md`**.

## 2. Translation — no setup needed
Translation (the add-exercise / add-sport name suggestions) runs **browser-direct**
using the LLM key you set in **Settings → AI** — no backend and no Edge Function to
deploy. The results are cached into a local dictionary and synced like any other row;
you can always override a translation manually.

> The `supabase/functions/translate` Edge Function and the backend `/api/translate`
> route are **legacy** — nothing calls them anymore. You can ignore (or delete) them.

## 3. Frontend
```bash
cd frontend
cp .env.example .env.local      # fill VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm install
npm run dev                     # http://localhost:5174
```
Log in with the account from step 1.3. Logging, history, dashboard, sports, injuries,
cycle, and settings all work against the local cache and sync to Supabase in the
background (and on "Settings → Sync now"). The AI features need a network connection
and — for chat / food-photo / file-summary — the backend below.

## 4. Import legacy data (optional)
- In-app: **Settings → Import legacy data** → upload `raw_data/workout_log.csv`.
- Or generate JSON via the reference script:
  ```bash
  node --experimental-strip-types migration/migrate.ts   # writes migration/out/
  ```

## 5. AI assistant backend (optional) 🔑
The backend is a thin relay for the three LLM calls that must run server-side (chat,
food-photo recognition, file summary). It stores **no** LLM keys — the browser sends
them per request — so its only secrets are your Supabase URL + anon key.

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # set SUPABASE_URL, SUPABASE_KEY (anon); FRONTEND_ORIGIN optional
uvicorn app.main:app --reload --port 8000
```
Then point the frontend at it: set `VITE_ASSISTANT_API_URL=http://localhost:8000`
in `frontend/.env.local`. Open the **Assistant** tab and ask about your training.

> Health check: `curl localhost:8000/health` → `{"ok":true,...}`.
>
> The Assistant is a multi-chatroom, permission-gated coach with per-room memory
> and pre-fillable data modules (Assistant tab → left drawer for rooms, right
> **Data**/**Memory** tabs). Food-photo recognition (which also estimates calories /
> macros) needs a **vision-capable model** in Settings → AI (claude-* / gpt-4o* /
> gemini-*); text-only models (e.g. deepseek-chat) will error on recognition but
> everything else still works.
>
> Without a reachable backend (`VITE_ASSISTANT_API_URL` unset, off localhost), the AI
> chat / food-photo / file-summary features disable themselves with a notice; the rest
> of the app is unaffected.

### 5b. Host the backend (so the assistant works on mobile)

Running the backend locally only gives you the assistant on that PC. To use it from
your phone, deploy the backend to any Python host. A [Render](https://render.com)
blueprint is included (`render.yaml`, free plan):

1. Render → **New → Blueprint** → connect this repo. It reads `render.yaml`.
2. Set the two `sync: false` env vars in the Render dashboard: `SUPABASE_URL` and
   `SUPABASE_KEY` (anon). `FRONTEND_ORIGIN` is preset to the Pages origin (edit it if
   your frontend lives elsewhere). Deploy → you get an HTTPS URL like
   `https://training-hub-backend.onrender.com`.
3. Point the frontend at it: add a GitHub Actions **secret** `VITE_ASSISTANT_API_URL`
   = that URL, then re-run the "Deploy frontend to GitHub Pages" workflow.

The backend stores **no** LLM keys (the browser sends them per request) and holds only
the browser-safe anon key + your Supabase URL. One backend can serve many accounts on
the same Supabase (RLS isolates them). The free plan sleeps when idle, so the first
request after a nap is slow (~30–60s cold start) — the UI shows a "waking up" hint.

> **Self-hosting / multi-user:** each deployment (its own Supabase project) needs its
> own backend, since the backend is bound to one Supabase project. Friends using *your*
> Supabase can share *your* backend. Alternatively the backend is optional — everything
> except chat / food-photo / file-summary (incl. AI translation, which is browser-direct)
> works without it.

---

## What only you can do (🔑)
1. Create the Supabase project + paste its URL/anon key into `.env.local`.
2. Run all 20 migration SQL files **in filename order** (init → training modules →
   AI chatroom/memory/data modules → cycle assignment, incl. the `injury-photos`,
   `food-photos` and `public-files` Storage buckets) and create your login account.
3. (Optional) Deploy the assistant backend and set `SUPABASE_URL` / `SUPABASE_KEY` on it.
4. Add your LLM API key(s) in the app under **Settings → AI**.

Everything else (schema, frontend, backend, migration parser) is in the repo and
verified to build/parse.
