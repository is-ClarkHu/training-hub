"""Minimal FastAPI backend (SPEC §5/§9). Relays LLM calls so API keys stay out of
the browser, and hides them from third-party CORS. Two endpoints:

  POST /api/translate  — fitness term zh⇄en (+ body_part/measure_type for exercises)
  POST /api/assistant  — memory-aware training chat

The browser sends the user's Supabase JWT (for RLS-scoped reads/caching) plus the
chosen provider/model/api_key (Settings → AI). Keys are never stored here.
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase import create_client

from .memory import SUMMARY_MAX_TOKENS, build_memory_context, maybe_update_summary
from .providers import PROVIDERS, chat

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")  # anon key (RLS-scoped via JWT)
FRONTEND_ORIGIN = os.environ.get("FRONTEND_ORIGIN", "*")

BODY_PARTS = {"chest", "back", "shoulders", "legs", "arms", "core", "frisbee"}
MEASURE_TYPES = {"weight_reps", "reps_only", "duration"}

ASSISTANT_SYSTEM = (
    "You are a knowledgeable, supportive strength-and-conditioning coach embedded "
    "in the user's training-log app. Answer using the user's own data below. Be "
    "concrete and concise; cite specific numbers and dates. Respect active injuries. "
    "Reply in the user's language (match their question)."
)

app = FastAPI(title="training-hub backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if FRONTEND_ORIGIN == "*" else [FRONTEND_ORIGIN],
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["*"],
)


class AiConfig(BaseModel):
    provider: str
    model: str = ""
    api_key: str = ""


class AssistantRequest(AiConfig):
    message: str
    chatroom_id: str = ""  # active room; "" = legacy single-room behavior


class TranslateRequest(AiConfig):
    domain: str
    text: str
    target: str = "en"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _user_client(jwt: str):
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise HTTPException(500, "Supabase env not configured")
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    try:
        user = sb.auth.get_user(jwt).user
    except Exception:  # noqa: BLE001
        raise HTTPException(401, "Invalid or expired session")
    if not user:
        raise HTTPException(401, "Invalid session")
    sb.postgrest.auth(jwt)
    return sb, user.id


def _jwt(authorization: str) -> str:
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing bearer token")
    return authorization.removeprefix("Bearer ").strip()


def _relay(cfg: AiConfig, system: str, user: str, max_tokens: int = 1024) -> str:
    if cfg.provider not in PROVIDERS:
        raise HTTPException(400, f"Unknown provider '{cfg.provider}'")
    try:
        return chat(cfg.provider, cfg.model, cfg.api_key, system, user, max_tokens)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:  # noqa: BLE001 — upstream/provider error
        raise HTTPException(502, f"{cfg.provider} error: {e}")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "providers": PROVIDERS}


# ── translation (§5) ─────────────────────────────────────────
DOMAIN_LABEL = {
    "exercise": "a strength-training exercise name",
    "body_part": "a body-part label",
    "note_tag": "a training-note fragment",
    "sport": "a sport / activity name",
}


def _translate_prompt(domain: str, target: str) -> str:
    lang = "English" if target == "en" else "Chinese"
    infer = (
        f'Also infer "suggested_body_part" (one of {sorted(BODY_PARTS)}) and '
        f'"suggested_measure_type" (one of {sorted(MEASURE_TYPES)}).'
        if domain == "exercise"
        else 'Set "suggested_body_part" and "suggested_measure_type" to null.'
    )
    return (
        f"You are a bilingual (Chinese⇄English) strength & sports translator. The input is "
        f"{DOMAIN_LABEL.get(domain, 'a fitness term')}. Translate it into {lang} using STANDARD "
        f"gym terminology, never literal (e.g. 牧师凳弯举→Preacher Curl, 高位下拉→Lat Pulldown). "
        f'{infer} Respond with ONLY a JSON object: '
        f'{{"translation": "...", "suggested_body_part": ... , "suggested_measure_type": ...}}'
    )


def _parse_json(reply: str) -> dict:
    m = re.search(r"\{.*\}", reply, re.DOTALL)
    if not m:
        return {"translation": reply.strip(), "suggested_body_part": None, "suggested_measure_type": None}
    try:
        return json.loads(m.group(0))
    except Exception:  # noqa: BLE001
        return {"translation": reply.strip(), "suggested_body_part": None, "suggested_measure_type": None}


@app.post("/api/translate")
def translate(body: TranslateRequest, authorization: str = Header(default="")) -> dict:
    if body.domain not in DOMAIN_LABEL:
        raise HTTPException(400, "unknown domain")
    if body.target not in ("en", "zh"):
        raise HTTPException(400, "target must be en|zh")
    sb, _ = _user_client(_jwt(authorization))

    src_col = "zh" if body.target == "en" else "en"
    existing = (
        sb.table("translation_dictionary").select("*").eq("domain", body.domain)
        .eq(src_col, body.text).eq("deleted", False).limit(1).execute()
    )
    if existing.data:
        row = existing.data[0]
        return {
            "text": row["en"] if body.target == "en" else row["zh"],
            "suggested_body_part": None, "suggested_measure_type": None,
            "source": row["source"], "row": row,
        }

    parsed = _parse_json(_relay(body, _translate_prompt(body.domain, body.target), body.text, 256))
    translation = str(parsed.get("translation", "")).strip()
    bp = parsed.get("suggested_body_part")
    mt = parsed.get("suggested_measure_type")
    bp = bp if bp in BODY_PARTS else None
    mt = mt if mt in MEASURE_TYPES else None

    zh = body.text if body.target == "en" else translation
    en = translation if body.target == "en" else body.text
    ins = sb.table("translation_dictionary").insert(
        {"domain": body.domain, "zh": zh, "en": en, "source": "ai", "verified": False}
    ).execute()
    row = ins.data[0] if ins.data else None
    return {"text": translation, "suggested_body_part": bp, "suggested_measure_type": mt, "source": "ai", "row": row}


# ── assistant (§9) ───────────────────────────────────────────
@app.post("/api/assistant")
def assistant(body: AssistantRequest, authorization: str = Header(default="")) -> dict:
    sb, user_id = _user_client(_jwt(authorization))
    room = body.chatroom_id or None

    # Read the room's permission matrix from the DB (RLS-scoped) — never trust the
    # client's toggles; enforcement happens here, at data-read time (req §14.4).
    perms: dict = {}
    if room:
        pr = sb.table("chatrooms").select("perms").eq("id", room).limit(1).execute()
        if pr.data:
            perms = pr.data[0].get("perms") or {}

    context, sources_used = build_memory_context(sb, user_id, room, perms)
    reply = _relay(body, f"{ASSISTANT_SYSTEM}\n\n{context}", body.message, 1500)

    ts = _now()
    rows = [
        {"id": str(uuid4()), "role": "user", "content": body.message, "chatroom_id": room, "created_at": ts, "updated_at": ts, "deleted": False},
        {"id": str(uuid4()), "role": "assistant", "content": reply, "chatroom_id": room, "created_at": ts, "updated_at": ts, "deleted": False},
    ]
    try:
        sb.table("chat_messages").insert(rows).execute()
    except Exception:  # noqa: BLE001
        pass

    # Fold aged-out messages into the room's rolling summary (best-effort — a summary
    # failure must never fail the answer). Reuses the request's provider/model/key.
    if room:
        try:
            maybe_update_summary(
                sb, room, lambda system, user: _relay(body, system, user, SUMMARY_MAX_TOKENS)
            )
        except Exception:  # noqa: BLE001
            pass

    return {"reply": reply, "sources_used": sources_used}
