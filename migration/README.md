# migration — legacy CSV → new schema (build task)

The legacy `../raw_data/workout_log.csv` is converted into the new per-set schema
by a migration script produced during the build (not delivered with the spec).

**Hard rules (SPEC §10.0):**
- `raw_data/` is **read-only** — read it, never write/move/delete it. It is gitignored.
- All output goes to `migration/out/` — **never** back into `raw_data/`.
- `workout_dashboard.html` is **reference only**; the rebuilt dashboard follows §8.

The script must parse messy human input (`×`-chains, `+`-joined reps, supersets,
durations, per-side, frisbee categories), collapse exercise aliases, reclassify
into the 7 body parts, seed the translation dictionary, flag ambiguous rows
`needs_review`, and be idempotent on re-import. See SPEC §10.1.
