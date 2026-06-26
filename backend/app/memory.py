"""build_memory_context() — assembles the AI assistant's memory (SPEC §9).

Four layers, each summarized (never raw dumps), with per-layer caps:
  1. Training data   — recent entries/sets, per-body-part activity, PRs
  2. State profile   — bodyweight, goal, active injuries, split
  3. Chat history    — recent messages for continuity
  4. AI insights     — latest insight rows

Privacy (§6C/§9): the intimacy tracker is NEVER queried here. There is no code
path that reads `optional_trackers`, so it cannot leak into the model context.
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


def build_memory_context(sb, user_id: str) -> str:
    """Return a compact textual context string for the system prompt.

    `sb` is a supabase client already scoped to the user (RLS), so every query
    returns only this user's rows.
    """
    since = (date.today() - timedelta(days=RECENT_DAYS)).isoformat()

    # ── Layer 2: profile ──────────────────────────────────────────────
    profile = (_rows(sb.table("profile").select("*").limit(1).execute()) or [{}])
    p = profile[0] if profile else {}
    injuries = _rows(
        sb.table("injuries").select("*").neq("status", "recovered").eq("deleted", False).execute()
    )

    # ── Layer 1: training data ────────────────────────────────────────
    exercises = {e["id"]: e for e in _rows(sb.table("exercises").select("*").execute())}
    entries = _rows(
        sb.table("workout_entries").select("*").gte("date", since).eq("deleted", False).execute()
    )
    entry_ids = [e["id"] for e in entries]
    sets = []
    if entry_ids:
        # chunk the IN filter to stay well under URL limits
        for i in range(0, len(entry_ids), 100):
            sets += _rows(
                sb.table("sets").select("*").in_("entry_id", entry_ids[i : i + 100]).eq("deleted", False).execute()
            )
    sport_sessions = _rows(
        sb.table("sport_sessions").select("*").gte("date", since).eq("deleted", False).execute()
    )

    # per-body-part activity counts
    bp_counter: Counter[str] = Counter()
    for e in entries:
        ex = exercises.get(e["exercise_id"])
        if ex:
            bp_counter[ex["body_part"]] += 1

    # top working-set weight per weight_reps exercise (rough PRs)
    sets_by_entry: dict[str, list[dict]] = {}
    for s in sets:
        sets_by_entry.setdefault(s["entry_id"], []).append(s)
    prs: dict[str, float] = {}
    for e in entries:
        ex = exercises.get(e["exercise_id"])
        if not ex or ex["measure_type"] != "weight_reps":
            continue
        for s in sets_by_entry.get(e["id"], []):
            w = s.get("weight")
            if w is not None and w > prs.get(ex["name_en"] or ex["name_zh"], 0):
                prs[ex["name_en"] or ex["name_zh"]] = w

    # ── Layer 3: chat history ─────────────────────────────────────────
    chat = _rows(
        sb.table("chat_messages").select("*").eq("deleted", False).order("created_at", desc=True).limit(MAX_CHAT_MESSAGES).execute()
    )
    chat = list(reversed(chat))

    # ── Layer 4: insights ─────────────────────────────────────────────
    insights = _rows(
        sb.table("insights").select("*").is_("superseded_by", "null").eq("deleted", False).order("created_at", desc=True).limit(MAX_INSIGHTS).execute()
    )

    # ── assemble ──────────────────────────────────────────────────────
    lines: list[str] = []
    lines.append("== User training profile ==")
    if p:
        if p.get("bodyweight_kg"):
            lines.append(f"Bodyweight: {p['bodyweight_kg']} kg")
        if p.get("goal"):
            lines.append(f"Goal: {p['goal']}")
        if p.get("notes"):
            lines.append(f"Notes: {p['notes']}")
    if injuries:
        inj = "; ".join(f"{i['body_area']} ({i['status']}, since {i['started_on']})" for i in injuries)
        lines.append(f"Active injuries: {inj}")
    else:
        lines.append("Active injuries: none")

    lines.append("")
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

    if insights:
        lines.append("")
        lines.append("== Prior AI insights ==")
        for ins in insights:
            lines.append(f"- {ins.get('content', '')}")

    if chat:
        lines.append("")
        lines.append("== Recent conversation ==")
        for m in chat:
            who = "User" if m["role"] == "user" else "Assistant"
            lines.append(f"{who}: {m['content']}")

    return "\n".join(lines)
