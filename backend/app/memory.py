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
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable

# How far back / how much to include (token-budget guards).
RECENT_DAYS = 56  # ~8 weeks
MAX_CHAT_MESSAGES = 12          # verbatim recent tail kept out of the summary
MAX_UNFOLDED = MAX_CHAT_MESSAGES + 12  # safety cap on messages shown since the watermark
MAX_INSIGHTS = 3
MAX_NOTES = 10
MAX_FOOD = 8
FILE_EXCERPT_CHARS = 1500  # capped excerpt per authorized reference file
MAX_SHARED_MEMORIES = 8  # cross-room shared memory units pulled in per answer

# Rolling summary (P4): fold aged-out messages into the room summary once this many
# have accumulated, so the fold LLM call is occasional rather than every turn.
FOLD_TRIGGER = 6
SUMMARY_MAX_TOKENS = 400
SUMMARY_SYSTEM = (
    "You maintain a concise running memory of one coaching chatroom. Merge the new "
    "earlier messages into the existing summary. Keep only durable, useful points, "
    "organized as: current goal, confirmed facts, decisions made, current plan, user "
    "preferences, open questions, things to watch. Drop small talk and anything "
    "superseded. Be terse. Reply with ONLY the updated summary."
)

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

    # ── Basic info (perms: basics) ────────────────────────────────────
    if allowed("basics"):
        b = _rows(sb.table("basics").select("*").eq("deleted", False).limit(1).execute())
        bm = _rows(
            sb.table("body_measurements").select("*").eq("deleted", False).order("date", desc=True).limit(3).execute()
        )
        blines: list[str] = []
        if b:
            r = b[0]
            fields = [
                ("Age", r.get("age")),
                ("Sex", r.get("sex")),
                ("Height", f"{r['height_cm']} cm" if r.get("height_cm") else None),
                ("Training level", r.get("training_level")),
                ("Training years", r.get("training_years")),
                ("Work type", r.get("work_type")),
                ("Sleep", f"{r['sleep_hours']} h" if r.get("sleep_hours") else None),
                ("Resting HR", r.get("resting_hr")),
                ("Max HR", r.get("max_hr")),
            ]
            blines += [f"{k}: {v}" for k, v in fields if v not in (None, "")]
        if bm:
            latest = bm[0]
            meas = [
                ("Weight", f"{latest['weight_kg']} kg" if latest.get("weight_kg") else None),
                ("Body fat", f"{latest['body_fat_pct']}%" if latest.get("body_fat_pct") else None),
                ("Muscle", f"{latest['muscle_kg']} kg" if latest.get("muscle_kg") else None),
                ("Waist", f"{latest['waist_cm']} cm" if latest.get("waist_cm") else None),
            ]
            cur = ", ".join(f"{k} {v}" for k, v in meas if v)
            if cur:
                blines.append(f"Latest measurements ({latest['date']}): {cur}")
            weights = [(m["date"], m["weight_kg"]) for m in bm if m.get("weight_kg") is not None]
            if len(weights) >= 2:
                blines.append(
                    f"Weight trend: {weights[-1][1]} kg ({weights[-1][0]}) -> {weights[0][1]} kg ({weights[0][0]})"
                )
        if blines:
            lines.append("== Basic info ==")
            lines.extend(blines)
            lines.append("")
            sources.append("Basic info")

    # ── Training environment (perms: training_env) ────────────────────
    if allowed("training_env"):
        te = _rows(sb.table("training_env").select("*").eq("deleted", False).limit(1).execute())
        if te:
            r = te[0]
            tl = [
                f"{k}: {r[c]}"
                for k, c in [("Gym", "gym"), ("Equipment", "equipment"), ("Home equipment", "home_equipment")]
                if r.get(c)
            ]
            if tl:
                lines.append("== Training environment ==")
                lines.extend(tl)
                lines.append("")
                sources.append("Training environment")

    # ── Supplements (perms: supplements) — only what's still in use ────
    if allowed("supplements"):
        sup = _rows(
            sb.table("supplements").select("*").eq("still_using", True).eq("deleted", False).execute()
        )
        if sup:
            lines.append("== Current supplements ==")
            for s in sup:
                parts = [s.get("name") or ""]
                if s.get("brand"):
                    parts.append(f"({s['brand']})")
                if s.get("dose"):
                    parts.append(str(s["dose"]))
                if s.get("frequency"):
                    parts.append(str(s["frequency"]))
                lines.append("- " + " ".join(p for p in parts if p))
            lines.append("")
            sources.append("Supplements")

    # ── Notes (perms: notes) ──────────────────────────────────────────
    if allowed("notes"):
        nts = _rows(
            sb.table("notes").select("*").eq("deleted", False).order("created_at", desc=True).limit(MAX_NOTES).execute()
        )
        if nts:
            lines.append("== Notes ==")
            for n in nts:
                tag = f"[{n['tag']}] " if n.get("tag") else ""
                lines.append(f"- {tag}{n['content']}")
            lines.append("")
            sources.append("Notes")

    # ── Medical background (perms: medical — HIGH-SENSITIVITY) ─────────
    if allowed("medical"):
        med = _rows(sb.table("medical_background").select("*").eq("deleted", False).limit(1).execute())
        if med:
            r = med[0]
            ml = [
                f"{k}: {r[c]}"
                for k, c in [
                    ("Conditions", "conditions"),
                    ("Surgeries", "surgeries"),
                    ("Exercise restrictions", "restrictions"),
                    ("Allergies", "allergies"),
                    ("Family history", "family_history"),
                    ("Recent labs", "recent_labs"),
                ]
                if r.get(c)
            ]
            if ml:
                lines.append("== Medical background (handle with care; respect restrictions & allergies) ==")
                lines.extend(ml)
                lines.append("")
                sources.append("Medical background")

    # ── Food log (perms: food) — text descriptions only (§4.5) ────────
    if allowed("food"):
        food = _rows(
            sb.table("food_log").select("*").eq("deleted", False).order("eaten_at", desc=True).limit(MAX_FOOD).execute()
        )
        food = [f for f in food if (f.get("description") or "").strip()]
        if food:
            lines.append("== Recent food log ==")
            for f in food:
                lines.append(f"- {str(f.get('eaten_at', ''))[:10]}: {f['description']}")
            lines.append("")
            sources.append("Food log")

    # ── Shared memory from other rooms (authorized only; NEVER inherits the source
    #    room's raw data or full chat — only its flagged memory units, req §6.4) ──
    if chatroom_id:
        grants = _rows(
            sb.table("chatroom_memory_access").select("source_room_id").eq("reader_room_id", chatroom_id).eq("deleted", False).execute()
        )
        source_ids = [g["source_room_id"] for g in grants]
        if source_ids:
            mems = _rows(
                sb.table("chatroom_memories").select("*").in_("chatroom_id", source_ids).eq("shareable", True).eq("deleted", False).order("updated_at", desc=True).limit(MAX_SHARED_MEMORIES).execute()
            )
            if mems:
                room_names = {
                    r["id"]: r.get("name", "another room")
                    for r in _rows(sb.table("chatrooms").select("id,name").in_("id", source_ids).execute())
                }
                lines.append("== Shared memory from other rooms ==")
                for m in mems:
                    src = room_names.get(m["chatroom_id"], "another room")
                    lines.append(f"[{src}] {m['content']}")
                lines.append("")
                for rn in sorted({room_names.get(m["chatroom_id"], "another room") for m in mems}):
                    sources.append(f"Memory · {rn}")

    # ── Reference files this room may read (per-file grant; capped excerpt) ──
    if chatroom_id:
        fgrants = _rows(
            sb.table("chatroom_file_access").select("file_id").eq("chatroom_id", chatroom_id).eq("deleted", False).execute()
        )
        file_ids = [g["file_id"] for g in fgrants]
        if file_ids:
            files = _rows(
                sb.table("public_files").select("*").in_("id", file_ids).eq("deleted", False).execute()
            )
            if files:
                lines.append("== Reference files ==")
                for f in files:
                    excerpt = (f.get("content") or "").strip()
                    if excerpt:
                        lines.append(f"[{f['name']}]\n{excerpt[:FILE_EXCERPT_CHARS]}")
                    else:
                        lines.append(f"[{f['name']}] (no readable text extracted)")
                    lines.append("")
                    sources.append(f"File · {f['name']}")

    # ── Room memory + recent conversation (always — the room's own history) ──
    summary_row = None
    if chatroom_id:
        srows = _rows(
            sb.table("chatroom_summaries").select("*").eq("chatroom_id", chatroom_id).eq("deleted", False).limit(1).execute()
        )
        summary_row = srows[0] if srows else None
    watermark = summary_row.get("covered_through") if summary_row else None

    chat_q = sb.table("chat_messages").select("*").eq("deleted", False)
    if chatroom_id:
        chat_q = chat_q.eq("chatroom_id", chatroom_id)
    if watermark:
        # the summary already covers everything up to the watermark; show what's since
        chat = _rows(chat_q.gt("created_at", watermark).order("created_at").limit(MAX_UNFOLDED).execute())
    else:
        chat = list(reversed(_rows(chat_q.order("created_at", desc=True).limit(MAX_CHAT_MESSAGES).execute())))

    if summary_row and summary_row.get("content"):
        lines.append("== Room memory (summary of earlier conversation) ==")
        lines.append(summary_row["content"])
        lines.append("")
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


def maybe_update_summary(sb, chatroom_id: str | None, summarize: Callable[[str, str], str]) -> bool:
    """Fold aged-out messages into the room's rolling summary (P4, req §7.2).

    Keeps the newest MAX_CHAT_MESSAGES verbatim; older messages past the summary's
    watermark are folded in incrementally (never re-reading the whole history) once
    FOLD_TRIGGER of them have accumulated. `summarize(system, user)` runs the LLM
    (the caller supplies the room's provider/key). Best-effort — returns whether the
    summary was updated. `sb` is RLS-scoped to the user.
    """
    if not chatroom_id:
        return False

    srows = _rows(
        sb.table("chatroom_summaries").select("*").eq("chatroom_id", chatroom_id).eq("deleted", False).limit(1).execute()
    )
    summary_row = srows[0] if srows else None
    watermark = summary_row.get("covered_through") if summary_row else None
    existing = (summary_row.get("content") or "") if summary_row else ""

    msgs = _rows(
        sb.table("chat_messages").select("*").eq("chatroom_id", chatroom_id).eq("deleted", False).order("created_at").execute()
    )
    if len(msgs) <= MAX_CHAT_MESSAGES:
        return False
    older = msgs[:-MAX_CHAT_MESSAGES]  # everything except the verbatim tail
    to_fold = [m for m in older if not watermark or m["created_at"] > watermark]
    if len(to_fold) < FOLD_TRIGGER:
        return False

    convo = "\n".join(
        f'{"User" if m["role"] == "user" else "Assistant"}: {m["content"]}' for m in to_fold
    )
    user = f"Existing summary:\n{existing or '(none yet)'}\n\nEarlier messages to fold into it:\n{convo}"
    new_summary = summarize(SUMMARY_SYSTEM, user).strip()
    if not new_summary:
        return False

    payload = {
        "content": new_summary,
        "covered_through": older[-1]["created_at"],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if summary_row:
        sb.table("chatroom_summaries").update(payload).eq("id", summary_row["id"]).execute()
    else:
        sb.table("chatroom_summaries").insert({"chatroom_id": chatroom_id, **payload}).execute()
    return True
