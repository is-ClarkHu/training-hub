# seed-demo — public demo-account seeder

Wipes and reseeds the demo Supabase account with a full showcase dataset so a
recruiter/visitor can log in and see every feature populated. Re-run daily by
`.github/workflows/seed-demo.yml` so the data always looks current (last workout =
today, an in-progress cycle, a fresh food log, active injuries mid-rehab…).

## What it seeds

- **~46 bilingual exercises** across all measure types + warm-up / rehab / per-side /
  bodyweight / cardio flags.
- **15 weeks** of coherent training (~290 entries, ~1000 sets) with rising loads →
  PRs + previous-session comparisons, warm-up sets, a superset, a dropset, per-side,
  reps-only and duration/cardio metrics.
- **Two cycles**: a completed Push/Pull/Legs cycle and the **current in-progress**
  Upper/Lower cycle (with rounds + entry↔cycle assignments).
- **3 sports** (Frisbee/Running/Gymnastics) with ~28 sessions (14 frisbee).
- **4 injury stories** at different lifecycle stages with checkpoints, declining
  pain assessments, and assigned rehab plans (+ logged rehab entries).
- **Profile + AI data modules**: basics, a 14-week measurement trend, notes,
  supplements, training environment, medical background.
- **Food log** (10 meals) with AI recognition + calorie/macro estimates and photos.
- **3 reference files** (plan / coach feedback / labs) with extracted text + summary.
- **3 AI chatrooms** with different permission matrices, seeded transcripts (the
  Strength room shows the answer difference before/after a permission is granted),
  rolling summaries, shareable/pinned memory units, a cross-room memory grant, and
  per-room file access.
- **Translation dictionary** mixing AI translations and manual overrides.
- Intimacy tracker is intentionally NOT seeded (private; hard-isolated by design).

## Run it

The seeder signs in **as the demo user** (anon key — no service_role) and only
touches that user's own rows (RLS) + storage folders.

```bash
cd frontend
npm ci
# dry run — assembles everything and prints row counts, no network:
npm run seed:demo
# real run:
SUPABASE_URL=… SUPABASE_ANON_KEY=… DEMO_EMAIL=… DEMO_PASSWORD=… npm run seed:demo
```

## One-time setup

1. In Supabase → Authentication → Users, create the demo account (email + password).
2. Add GitHub repo secrets `DEMO_EMAIL` and `DEMO_PASSWORD` (the workflow reuses the
   existing `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` secrets for the connection).
3. Enable the **Seed demo account** workflow (or run it once via "Run workflow").

Runs under `node --experimental-strip-types` (Node 22+); no build step, no extra deps
beyond what `frontend/` already has.
