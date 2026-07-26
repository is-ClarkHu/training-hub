# backend — Phase 2 AI assistant

Minimal FastAPI whose job is to keep provider API keys off the browser and build
the assistant's context. The frontend sends the user's Supabase JWT (verified here,
RLS-scoped reads) plus the chosen provider/model/key per request (Settings → AI);
keys are never stored.

## Endpoints (`app/main.py`)
- `POST /api/assistant` — multi-chatroom coach. Reads the room's permission matrix
  from the DB, builds a permission-gated memory context, calls the model, persists
  both turns to `chat_messages` (scoped to the room), folds aged-out messages into
  the room's rolling summary, and returns `{reply, sources_used, suggested_memory}`.
- `POST /api/describe-food` — vision: a meal photo → short description (needs a
  vision-capable model).
- `POST /api/summarize-file` — LLM summary of a reference file's text.
- `POST /api/translate` — fitness-term zh⇄en (also available as a Supabase Edge
  Function; see `../supabase/functions/translate`).
- `GET /health`.

## Modules
- `app/providers.py` — multi-provider relay (Anthropic + OpenAI-compatible +
  Gemini): `chat()` for text, `describe_image()` for vision.
- `app/memory.py` — `build_memory_context()` assembles context **gated by the
  chatroom's `perms`** (only authorized categories are queried, enforced at read
  time): profile, training, injuries, basics + measurement trend, training_env,
  supplements, food, notes (ranked by query relevance), medical (high-sensitivity),
  authorized cross-room shared memories, authorized reference files, plus the room's
  rolling summary + recent messages. Also `maybe_update_summary()` (rolling summary,
  §7.2). **The intimacy tracker is never queried — hard-isolated, never reaches the
  model.**
- `app/aliases.py` — synonym / body-part alias table (肩=shoulder=过顶=rotator
  cuff…) used to focus retrieval and rank free-text notes (rule-based recall; no
  embeddings).

Design & decisions: `../docs/PLAN-ai-chatrooms.md`.

## Run
```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # SUPABASE_URL, SUPABASE_KEY (anon); FRONTEND_ORIGIN optional
uvicorn app.main:app --reload --port 8000
```

See `../SETUP.md` for the full end-to-end setup.
