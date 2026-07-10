"""build_memory_context() — assembles the AI assistant's per-chatroom memory.

The context is gated by the chatroom's permission matrix (PLAN-ai-chatrooms P3):
only categories the room is authorized to read are queried, so an unauthorized
category is never even fetched — enforcement happens at data-read time, not in the
UI (req §14.4). Returns the context string plus `sources_used` — human-readable
labels of what actually went in, powering the "this answer used …" disclosure.

Categories (v1 / existing data): profile_min, training, injuries. The room's own
recent conversation is always included (continuity, not a gated data category).

Privacy: the intimacy tracker is NEVER queried here and is not a permission
category — it is hard-isolated and cannot reach the model.
"""
from __future__ import annotations

from collections import Counter
from datetime import date, timedelta
from typing import Any

# How far back / how much to include (token-budget guards).
RECENT_DAYS = 56  # ~8 weeks
MAX_CHAT_MESSAGES = 12
MAX_INSIGHTS = 3

BODY_PART_LABELS = {
    "chest": "Chest", "back": "Back", "shoulders": "Shoulders", "legs": "Legs",
    "arms": "Arms", "core": "Core", "frisbee": "Frisbee",
}


def _rows(resp: Any) -> list[dict]:
    return getattr(resp, "data", None) or []


def build_memory_context(
    sb, user_id: str, chatroom_id: str | None = None, perms: dict | None = None
) -> tuple[str, list[str]]:
    """Return `(context, sources_used)` for the system prompt.

    `sb` is a supabase client already scoped to the user (RLS). `perms` is the
    room's permission matrix ({category: bool}); only authorized categories are
    queried. `sources_used` lists the labels of the data that actually made it in.
    """
    perms = perms or {}

    def allowed(cat: str) -> bool:
        return bool(perms.get(cat))

    since = (date.today() - timedelta(days=RECENT_DAYS)).isoformat()
    lines: list[str] = []
    sources: list[str] = []

    # ── Basic profile (perms: profile_min) ────────────────────────────
    if allowed("profile_min"):
        prof = _rows(sb.table("profile").select("*").limit(1).execute())
        p = prof[0] if prof else {}
        prof_lines: list[str] = []
        if p.get("bodyweight_kg"):
            prof_lines.append(f"Bodyweight: {p['bodyweight_kg']} kg")
        if p.get("goal"):
            prof_lines.append(f"Goal: {p['goal']}")
        if p.get("notes"):
            prof_lines.append(f"Notes: {p['notes']}")
        if prof_lines:
            lines.append("== Basic profile ==")
            lines.extend(prof_lines)
            lines.append("")
            sources.append("Basic profile")

    # ── Active injuries (perms: injuries — sensitive) ─────────────────
    if allowed("injuries"):
        injuries = _rows(
            sb.table("injuries").select("*").neq("status", "recovered").eq("deleted", False).execute()
        )
        if injuries:
            inj = "; ".join(
                f"{i['body_area']} ({i['status']}, since {i['started_on']})" for i in injuries
            )
            lines.append("== Active injuries ==")
            lines.append(inj)
            lines.append("")
            sources.append("Active injuries")

    # ── Training data (perms: training) ───────────────────────────────
    if allowed("training"):
        exercises = {e["id"]: e for e in _rows(sb.table("exercises").select("*").execute())}
        entries = _rows(
            sb.table("workout_entries").select("*").gte("date", since).eq("deleted", False).execute()
        )
        entry_ids = [e["id"] for e in entries]
        sets: list[dict] = []
        if entry_ids:
            # chunk the IN filter to stay well under URL limits
            for i in range(0, len(entry_ids), 100):
                sets += _rows(
                    sb.table("sets").select("*").in_("entry_id", entry_ids[i : i + 100]).eq("deleted", False).execute()
                )
        sport_sessions = _rows(
            sb.table("sport_sessions").select("*").gte("date", since).eq("deleted", False).execute()
        )

        # per-body-part activity counts (exercises now carry a body_parts array)
        bp_counter: Counter[str] = Counter()
        for e in entries:
            ex = exercises.get(e["exercise_id"])
            if ex:
                for bp in ex.get("body_parts") or []:
                    bp_counter[bp] += 1

        # top working-set weight per weight_reps exercise (rough PRs)
        sets_by_entry: dict[str, list[dict]] = {}
        for s in sets:
            sets_by_entry.setdefault(s["entry_id"], []).append(s)
        prs: dict[str, float] = {}
        for e in entries:
            ex = exercises.get(e["exercise_id"])
            if not ex or ex.get("measure_type") != "weight_reps":
                continue
            name = ex.get("name_en") or ex.get("name_zh") or ""
            for s in sets_by_entry.get(e["id"], []):
                w = s.get("weight")
                if w is not None and w > prs.get(name, 0):
                    prs[name] = w

        if entries or sport_sessions:
            lines.append(f"== Recent activity (last {RECENT_DAYS} days) ==")
            lines.append(f"Strength entries: {len(entries)} across {len({e['date'] for e in entries})} days")
            if bp_counter:
                dist = ", ".join(f"{BODY_PART_LABELS.get(bp, bp)} {n}" for bp, n in bp_counter.most_common())
                lines.append(f"Body-part focus: {dist}")
            if sport_sessions:
                hrs = sum(s.get("hours", 0) for s in sport_sessions)
                lines.append(f"Sport sessions: {len(sport_sessions)} ({hrs:.1f} h)")
            if prs:
                top = sorted(prs.items(), key=lambda kv: kv[1], reverse=True)[:8]
                lines.append("Top working-set weights: " + ", ".join(f"{name} {w}" for name, w in top))
            lines.append("")
            sources.append("Recent training")

        # AI insights summarize training, so they ride with the training grant.
        insights = _rows(
            sb.table("insights").select("*").is_("superseded_by", "null").eq("deleted", False).order("created_at", desc=True).limit(MAX_INSIGHTS).execute()
        )
        if insights:
            lines.append("== Prior AI insights ==")
            for ins in insights:
                lines.append(f"- {ins.get('content', '')}")
            lines.append("")
            sources.append("Prior AI insights")

    # ── Recent conversation (always — the room's own history) ─────────
    chat_q = sb.table("chat_messages").select("*").eq("deleted", False)
    if chatroom_id:
        chat_q = chat_q.eq("chatroom_id", chatroom_id)
    chat = _rows(chat_q.order("created_at", desc=True).limit(MAX_CHAT_MESSAGES).execute())
    chat = list(reversed(chat))
    if chat:
        lines.append("== Recent conversation ==")
        for m in chat:
            who = "User" if m["role"] == "user" else "Assistant"
            lines.append(f"{who}: {m['content']}")
        lines.append("")

    if not sources:
        lines.append(
            "(No personal data is authorized for this room — answer from general "
            "knowledge and the conversation only.)"
        )

    return "\n".join(lines).strip(), sources
