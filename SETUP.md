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
2. **Apply the schema + migrations, in order.** Easiest: Supabase dashboard → SQL
   Editor → paste each file's contents → Run, one at a time, top to bottom:
   1. `supabase/migrations/20260624120000_init_schema.sql` — base schema
   2. `supabase/migrations/20260706120000_injury_v2.sql` — injuries as events (7-stage status, bilingual body area/note, laterality/type/scenario, checkpoints, attachments)
   3. `supabase/migrations/20260706130000_rehab_library.sql` — rehab-exercise fields on `exercises`
   4. `supabase/migrations/20260706140000_rehab_loop.sql` — per-injury rehab plan + symptom assessments
   5. `supabase/migrations/20260706150000_injury_photos_storage.sql` — private `injury-photos` Storage bucket + RLS (needed before injury photos can upload/view)

   (Or with the CLI: `supabase link` then `supabase db push` applies them all in
   order automatically.)
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

---

## What only you can do (🔑)
1. Create the Supabase project + paste its URL/anon key into `.env.local`.
2. Run the migration SQL **in order** (init + the four injury-module migrations,
   incl. the `injury-photos` Storage bucket) and create your login account.
3. Deploy the `translate` Edge Function and set `ANTHROPIC_API_KEY`.
4. Provide `ANTHROPIC_API_KEY` to the Phase-2 backend.

Everything else (schema, frontend, edge function code, backend, migration parser)
is in the repo and verified to build/parse.
