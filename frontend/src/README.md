# frontend/src — module map

Each directory is a module built one at a time against the SPEC. The client keeps a
local Dexie/IndexedDB cache as its instant working copy; SyncEngine reconciles it with
Supabase (the source of truth) in the background.

| dir | responsibility | SPEC |
|-----|----------------|------|
| `db/` | Dexie schema + queries (mirrors the Supabase tables) | §3, §4 |
| `sync/` | SyncEngine — `supabase-js` upsert/pull, last-write-wins, sets `user_id` | §3 |
| `supabase/` | client init, generated table types, RLS-aware queries | §3 |
| `ai/` | provider-agnostic LLM clients (`chatComplete`) + per-task config + browser-held API keys | §5, §9 |
| `i18n/` | `en.json`, `zh.json` — UI chrome only (i18next) | §5.4 |
| `translation/` | true bilingual **data** (not just labels): `resolve()` three-tier resolver, dictionary cache, and a **browser-direct** LLM translate client | §5 |
| `categories/` | shared body-part / muscle category keys + labels | §4 |
| `components/` | shared UI primitives (oscilloscope/training-monitor aesthetic) | §8 |
| `undo/` | transient undo toasts for destructive actions | §7 |
| `migration/` | in-app legacy CSV → app importer (paired with root `../migration/`) | §13 |
| `features/auth` | login gate (Supabase email+password); logout clears Dexie | §7.0 |
| `features/log` | default tab: per-set logging, supersets, note tags, add-exercise | §7.1, §6 |
| `features/history` | reverse-chron sessions; edit/delete; surface needs_review | §7.2 |
| `features/dashboard` | bilingual charts: heatmap, progression, distributions | §8 |
| `features/sports` | user-creatable sport library (CRUD + 4 tier labels) + session logging & mini-charts | §4.5, §7.4 |
| `features/injuries` | injury log + rehab timeline | §6A |
| `features/cycle` | training loop editor, today/next, per-muscle recovery spacing | §6B |
| `features/settings` | language toggle, profile, translation manager, trackers (intimacy) | §7.8, §6C |
| `features/assistant` | multi-chatroom AI coach: room drawer, per-room permission chips + "sources used", right-pane **Memory** (rolling summary, memory units, cross-room sharing) and **Data** (basics/measurements+chart, food+vision, supplements, training_env, notes, medical, public files) | §9, `docs/PLAN-ai-chatrooms.md` |

Build order: see SPEC §12.
