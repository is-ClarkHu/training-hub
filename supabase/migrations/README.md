# supabase/migrations — schema source of truth

SQL migrations define every table in SPEC §4, including the Phase-2 tables
(`chat_messages`, `insights`) created empty so the sync schema is stable.

**Mandatory on every user-data table** (SPEC §4 global rule, §3 auth model):
- `user_id uuid` (FK → `auth.users`), set on insert from the session.
- `updated_at` (ISO8601) and `deleted` (soft-delete flag) for sync.
- RLS policy `user_id = auth.uid()` for select / insert / update / delete.

Auth: email+password ON, public sign-ups CLOSED in v1 (single account).
Opening to ~10 users later needs no schema change — RLS already isolates data.
