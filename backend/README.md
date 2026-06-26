# backend — Phase 2 AI assistant (SPEC §9)

Minimal FastAPI whose only job is to keep the Claude API key off the browser.
Exposes `POST /api/assistant`: the frontend sends the user's Supabase JWT, the
backend verifies it, builds a memory context scoped to that user (RLS), calls
Claude, and persists both messages to `chat_messages`.

- `app/main.py` — FastAPI app + `/api/assistant` + `/health`.
- `app/memory.py` — `build_memory_context()` (training data, profile, chat
  history, insights — summarized; the intimacy tracker is never queried, §6C/§9).

## Run
```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_KEY (anon)
uvicorn app.main:app --reload --port 8000
```

Translation (`/api/translate`, §5) runs as a Supabase **Edge Function**
(`../supabase/functions/translate`), not here. See `../SETUP.md` for the full
end-to-end setup.
