# training-hub — setup & run

Everything in the repo is built; these steps connect it to **your** Supabase
project and (optionally) run the Phase-2 assistant. The credential/account steps
(marked 🔑) can only be done by you — they require logging into your accounts.

## Prerequisites
- Node 20+ (you have 22), Python 3.10+ for the Phase-2 backend.
- A Supabase account, and an Anthropic API key (for translation + assistant).

---

## 1. Supabase project 🔑
1. Create a project at supabase.com → copy the **Project URL** and **anon key**
   (Settings → API).
2. **Apply the schema + migrations, in filename order.** Easiest: Supabase
   dashboard → SQL Editor → paste each file's contents → Run, one at a time, top
   to bottom. (Or with the CLI: `supabase link` then `supabase db push` applies
   them all in order automatically.) Full index: `supabase/migrations/README.md`.

   **Core schema & training modules:**
   1. `20260624120000_init_schema.sql` — base schema (+ empty Phase-2 `chat_messages`/`insights`)
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
3. **Auth** (Authentication → Providers → Email): enable Email; turn **off**
   "Allow new users to sign up". Create your single account under
   Authentication → Users → Add user (email + password).

> **Injury photos** are compressed client-side (≤1600px JPEG), uploaded to the
> private `injury-photos` bucket (one folder per user, RLS-isolated), and cached
> locally for offline viewing. Medical imaging is intentionally unsupported.
> Migration 5 above must be run or photo upload will fail.
>
> Full feature walkthrough: **`docs/injury-module.md`**.

## 2. Translation Edge Function 🔑 (needed for add-exercise / add-sport suggestions)
```bash
# install the Supabase CLI if needed: npm i -g supabase
supabase link --project-ref <your-ref>
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...     # optional: TRANSLATE_MODEL=claude-haiku-4-5
supabase functions deploy translate
```
The function reads `SUPABASE_URL` / `SUPABASE_ANON_KEY` (injected automatically)
and the `ANTHROPIC_API_KEY` secret. The app works without it — you just type the
other-language name manually when adding exercises/sports.

## 3. Frontend
```bash
cd frontend
cp .env.example .env.local      # fill VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm install
npm run dev                     # http://localhost:5173
```
Log in with the account from step 1.3. Everything (logging, history, dashboard,
sports, injuries, cycle, settings) works offline-first; the SyncEngine pushes to
Supabase in the background and on "Settings → Sync now".

## 4. Import legacy data (optional)
- In-app: **Settings → Import legacy data** → upload `raw_data/workout_log.csv`.
- Or generate JSON via the reference script:
  ```bash
  node --experimental-strip-types migration/migrate.ts   # writes migration/out/
  ```

## 5. Phase-2 AI assistant backend (optional) 🔑
```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # set ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_KEY (anon)
uvicorn app.main:app --reload --port 8000
```
Then point the frontend at it: set `VITE_ASSISTANT_API_URL=http://localhost:8000`
in `frontend/.env.local` (the default is already `:8000`). Open the **Assistant**
tab and ask about your training.

> Health check: `curl localhost:8000/health` → `{"ok":true,...}`.
>
> The Assistant is a multi-chatroom, permission-gated coach with per-room memory
> and pre-fillable data modules (Assistant tab → left drawer for rooms, right
> **Data**/**Memory** tabs). Food-photo recognition needs a **vision-capable
> model** in Settings → AI (claude-* / gpt-4o* / gemini-*); text-only models
> (e.g. deepseek-chat) will error on recognition but everything else still works.

---

## What only you can do (🔑)
1. Create the Supabase project + paste its URL/anon key into `.env.local`.
2. Run all 17 migration SQL files **in filename order** (init → training modules →
   AI chatroom/memory/data modules, incl. the `injury-photos`, `food-photos` and
   `public-files` Storage buckets) and create your login account.
3. Deploy the `translate` Edge Function and set `ANTHROPIC_API_KEY`.
4. Provide `ANTHROPIC_API_KEY` to the Phase-2 backend.

Everything else (schema, frontend, edge function code, backend, migration parser)
is in the repo and verified to build/parse.
