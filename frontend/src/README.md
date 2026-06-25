# frontend/src — module map

Each directory is a module to be built one at a time against the SPEC. Local-first:
Dexie/IndexedDB is the instant source of truth; SyncEngine reconciles with Supabase.

| dir | responsibility | SPEC |
|-----|----------------|------|
| `db/` | Dexie schema + queries (mirrors the Supabase tables, local-first) | §3, §4 |
| `sync/` | SyncEngine — `supabase-js` upsert/pull, last-write-wins, sets `user_id` | §3 |
| `supabase/` | client init, generated table types, RLS-aware queries | §3 |
| `i18n/` | `en.json`, `zh.json` — UI chrome only (i18next) | §5.4 |
| `translation/` | `resolve()`, dictionary cache, `/api/translate` client, offline fallback | §5 |
| `translation/` | true bilingual **data** (not just labels) — first-class module | §5 |
| `components/` | shared UI primitives (oscilloscope/training-monitor aesthetic) | §8 |
| `features/auth` | login gate (Supabase email+password); logout clears Dexie | §7.0 |
| `features/log` | default tab: per-set logging, supersets, note tags, add-exercise | §7.1, §6 |
| `features/history` | reverse-chron sessions; edit/delete; surface needs_review | §7.2 |
| `features/dashboard` | bilingual charts: heatmap, progression, distributions | §8 |
| `features/sports` | user-creatable sport library (CRUD + 4 tier labels) + session logging & mini-charts | §4.5, §7.4 |
| `features/injuries` | injury log + rehab timeline | §6A |
| `features/cycle` | training loop editor, today/next, per-muscle recovery spacing | §6B |
| `features/settings` | language toggle, profile, translation manager, trackers (intimacy) | §7.8, §6C |
| `features/assistant` | Phase 2 chat UI | §9 |

Build order: see SPEC §12.
