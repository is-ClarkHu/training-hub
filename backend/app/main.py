"""Minimal FastAPI backend — Phase 2 only (SPEC §9).

One job: hide the Claude API key from the browser. Exposes POST /api/assistant.
The browser sends the user's Supabase JWT; we verify it, build a memory context
scoped to that user (RLS), call Claude, and persist both messages.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from uuid import uuid4

from anthropic import Anthropic
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase import create_client

from .memory import build_memory_context

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")  # anon key (RLS-scoped via JWT)
FRONTEND_ORIGIN = os.environ.get("FRONTEND_ORIGIN", "*")
MODEL = os.environ.get("ASSISTANT_MODEL", "claude-opus-4-8")

SYSTEM_PROMPT = (
    "You are a knowledgeable, supportive strength-and-conditioning coach embedded "
    "in the user's training-log app. Answer using the user's own data provided "
    "below. Be concrete and concise; cite specific numbers and dates when relevant. "
    "Respect active injuries — never recommend loading an injured area. If the data "
    "is insufficient to answer, say so and suggest what to log. Reply in the user's "
    "language (match the language of their question)."
)

app = FastAPI(title="training-hub assistant")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN] if FRONTEND_ORIGIN != "*" else ["*"],
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["*"],
)

anthropic = Anthropic(api_key=ANTHROPIC_API_KEY) if ANTHROPIC_API_KEY else None


class AssistantRequest(BaseModel):
    message: str


class AssistantResponse(BaseModel):
    reply: str


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _user_client(jwt: str):
    """A Supabase client scoped to the caller (RLS) + the verified user id."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise HTTPException(500, "Supabase env not configured")
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    try:
        user = sb.auth.get_user(jwt).user
    except Exception:  # noqa: BLE001 — any failure means bad/expired token
        raise HTTPException(401, "Invalid or expired session")
    if not user:
        raise HTTPException(401, "Invalid session")
    sb.postgrest.auth(jwt)  # scope all reads/writes to this user via RLS
    return sb, user.id


@app.get("/health")
def health() -> dict:
    return {"ok": True, "model": MODEL, "configured": bool(anthropic)}


@app.post("/api/assistant", response_model=AssistantResponse)
def assistant(body: AssistantRequest, authorization: str = Header(default="")) -> AssistantResponse:
    if anthropic is None:
        raise HTTPException(500, "ANTHROPIC_API_KEY not set")
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing bearer token")
    jwt = authorization.removeprefix("Bearer ").strip()

    sb, user_id = _user_client(jwt)
    context = build_memory_context(sb, user_id)

    resp = anthropic.messages.create(
        model=MODEL,
        max_tokens=1500,
        thinking={"type": "adaptive"},
        output_config={"effort": "medium"},
        system=f"{SYSTEM_PROMPT}\n\n{context}",
        messages=[{"role": "user", "content": body.message}],
    )
    reply = "".join(b.text for b in resp.content if b.type == "text").strip()

    # Persist both turns (chat_messages; user_id defaults to auth.uid()).
    ts = _now()
    rows = [
        {"id": str(uuid4()), "role": "user", "content": body.message, "created_at": ts, "updated_at": ts, "deleted": False},
        {"id": str(uuid4()), "role": "assistant", "content": reply, "created_at": ts, "updated_at": ts, "deleted": False},
    ]
    try:
        sb.table("chat_messages").insert(rows).execute()
    except Exception:  # noqa: BLE001 — persistence is best-effort
        pass

    return AssistantResponse(reply=reply)
