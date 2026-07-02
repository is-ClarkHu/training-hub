# Workout Tracker — SPEC Change Set v2

> **Purpose:** This document collects the **new features to add** on top of the
> main spec (SPEC.md v3). It is a change set, not a replacement — once reviewed,
> it folds into the main SPEC. Same constraints apply (gitignored, English build,
> bilingual app, Supabase + multi-user RLS: every new table gets `user_id` +
> `updated_at` + `deleted` and per-user RLS, like all others).

Three additions:
1. **Activities** — generalize "frisbee" into user-managed sport projects (CRUD).
2. **Split training system** — build custom training splits with a loop counter,
   skippable parts, multiple plans, custom tags, and a 2D body model for presets.
3. **Compact view** — a stripped-down Log display.

---

## 1. Activities (generalize frisbee → user-managed sports)

### 1.1 Concept
Frisbee is just one sport the user does; there are others. Replace the hardcoded
`frisbee_entries` notion with a general **Activity** concept the user can
create / rename / hide / delete. Each activity logs sessions with a duration, an
intensity level, injury flag, and a note — the same shape frisbee already had.

> Migration note: existing frisbee data becomes the seed "Frisbee" activity. The
> four frisbee categories (toss/casual/club/major) become Frisbee's four
> intensity levels (renamed per §1.3).

### 1.2 Data model

`activities` (the catalog of sports):
| field | type | notes |
|-------|------|-------|
| id | uuid (PK) | |
| name_zh / name_en | text | bilingual, via the §5 translation subsystem |
| visible | bool | Settings toggle; hidden activities disappear from logging & charts but keep their records (see §1.4) |
| sort_order | int | display order |
| (+ user_id, updated_at, deleted) | | standard |

`activity_levels` (per-activity intensity scale — default 4, renamable):
| field | type | notes |
|-------|------|-------|
| id | uuid (PK) | |
| activity_id | fk → activities | |
| level | int | 1–4 by default |
| label_zh / label_en | text | neutral defaults (NOT frisbee terms), user-editable |
| (+ user_id, updated_at, deleted) | | |

> **Default level labels are neutral** (e.g. L1 "Light / 轻松", L2 "Moderate /
> 中等", L3 "Hard / 高强度", L4 "Competition / 比赛"). Do NOT default to
> toss/casual/club/major — those were frisbee-specific. The user renames freely.
> Frisbee, when migrated, MAY keep its original four names as its labels.

`activity_entries` (replaces `frisbee_entries`):
| field | type | notes |
|-------|------|-------|
| id | uuid (PK) | |
| date | date | |
| activity_id | fk → activities | |
| hours | float | duration |
| level | int | references one of the activity's levels |
| injury | bool | injury / rehab flag |
| estimated | bool | duration estimated (e.g. multi-day tournament) |
| note_raw / note_tags | text / json | bilingual notes (§5) |
| (+ user_id, updated_at, deleted) | | |

### 1.3 Levels
Every activity has its own 1–4 scale (default count 4, but allow the user to
keep it simple). The 4-tier idea is inherited from frisbee because it's a sound
default; labels are neutral and per-activity editable (§1.2).

### 1.4 Delete vs. hide (decided)
- Primary action is a **visibility toggle in Settings** ("show / hide activity").
  Hidden = removed from logging UI and charts, **records preserved**. This is the
  default and recommended path — nothing is lost.
- A true **delete** may exist but must warn that it affects historical records;
  given the visibility toggle, delete is secondary. (Records-handling on hard
  delete: soft-delete the activity and its entries via the `deleted` flag; never
  hard-purge automatically.)

### 1.5 UI
- **Activity logging** lives where Frisbee was (its own tab or section), now a
  picker: choose activity → duration → level → injury → note.
- **Settings → Activities:** add / rename / reorder / show-hide.
- Charts that referenced frisbee now group by activity (and by level within).

---

## 2. Split training system

The user cares a lot about split routines. This is the largest v2 addition.

### 2.1 Concepts
- A **Split Plan** = an ordered set of **parts** (training days / blocks) that run
  as a loop. Finishing all parts once = one **cycle** (counter increments).
- **Two kinds of plan:**
  - **Preset plans** (scientifically common): e.g. the 7 body parts; Push/Pull;
    Upper/Lower; PPL. **Only preset plans get the 2D body model** (§2.6), because
    their parts map precisely to body regions.
  - **Custom plans**: user-assembled parts in any combination. Custom plans do
    NOT require the body model; instead they get a **loop ring** visualization
    (§2.6) — each part = one colored segment, completing a part lights its color,
    a full ring = one cycle.
- **Multiple plans coexist** (e.g. a normal-phase plan and a rehab-phase plan);
  one is active at a time, user can switch.
- **Skip:** any part can be skipped in the current cycle.
- **Custom tags:** beyond the 7 preset body parts, the user can create finer tags
  (e.g. quad / rear-delt / calf / ankle / 股四头 / 后束 / 小腿 / 脚踝) and attach
  them to parts — useful for rehab targeting and detail tracking.
- **Cycle counter:** tracks how many full loops completed per plan.

### 2.2 Data model

`split_plans`:
| field | type | notes |
|-------|------|-------|
| id | uuid (PK) | |
| name_zh / name_en | text | bilingual |
| kind | text | `preset` \| `custom` |
| preset_key | text/null | for presets: `seven_parts` \| `push_pull` \| `upper_lower` \| `ppl` … (drives which body model mapping to use) |
| active | bool | one active plan at a time |
| cycle_count | int | completed full loops |
| (+ user_id, updated_at, deleted) | | |

`split_parts` (ordered parts within a plan):
| field | type | notes |
|-------|------|-------|
| id | uuid (PK) | |
| plan_id | fk → split_plans | |
| order_index | int | position in the loop |
| name_zh / name_en | text | e.g. "Push / 推", "Chest / 胸" |
| body_parts | json | list of the 7 canonical body-part keys this part covers (drives body-model highlight + auto-link) |
| color | text | hex; used by the loop-ring viz (esp. custom plans) |
| (+ user_id, updated_at, deleted) | | |

`split_tags` (user-defined finer tags):
| field | type | notes |
|-------|------|-------|
| id | uuid (PK) | |
| name_zh / name_en | text | e.g. 股四头 / quad |
| maps_to_body_part | text/null | optional link to one of the 7 (for body-model tinting) |
| (+ user_id, updated_at, deleted) | | |

`split_part_tags` (M:N — which tags a part targets): `part_id`, `tag_id`.

`cycle_progress` (tracks the current loop's completion per plan):
| field | type | notes |
|-------|------|-------|
| id | uuid (PK) | |
| plan_id | fk → split_plans | |
| cycle_number | int | which loop this row belongs to |
| part_id | fk → split_parts | |
| status | text | `pending` \| `done` \| `skipped` |
| done_date | date/null | when marked done |
| source | text | `auto` (from training log) \| `manual` (user override) |
| (+ user_id, updated_at, deleted) | | |

### 2.3 Progress driving (decided: auto-link by default, manual override)
- **Auto:** when the user logs a workout that trains a part's `body_parts`, the
  matching `cycle_progress` row flips to `done` (`source=auto`) for the active
  plan's current cycle. This connects the split to the existing workout log so the
  user doesn't double-enter.
- **Manual override:** the user can mark a part done/skipped/pending by hand
  (`source=manual`); manual wins over auto for that part+cycle.
- **Cycle rollover:** when every part in the active plan is `done` or `skipped`,
  increment `split_plans.cycle_count`, start a new `cycle_number`, reset parts to
  `pending`. Skipped parts do not block rollover.

### 2.4 Relationship to the §6B "training cycle" already in the main spec
The main SPEC (v3 §6B) already introduced a lightweight A/B/C/D cycle with
`cycle_day_label` on entries and a "today/next" indicator. **v2 supersedes and
generalizes that** into this full split system. Action for the merge: replace
§6B's minimal model with §2 here; keep the "next part" indicator and the
per-muscle-group "days since last trained" panel as features of this system.

### 2.5 Plans, presets, custom — UI
- **Settings / Split editor:** create a plan (pick preset or custom) → define
  ordered parts → assign body parts + color + tags per part → set active.
- **Split screen (main):** shows the active plan, current cycle position
  ("next: Pull"), the loop ring or body model, cycle counter, and per-part
  done/skip controls.
- Multiple plans listed; switching active plan is one tap. Rehab plan example:
  parts weighted toward posterior chain / ankle with custom tags.

### 2.6 Visualization (phased)

**Phase 1 (v2 core) — static:**
- **Preset plans → 2D body model.** A front/back 2D human silhouette; each part's
  `body_parts` region is tinted/lit when that part is done this cycle. Static
  highlight only (no hover/click yet). Provide the SVG body regions for the 7
  canonical parts so highlighting is a matter of toggling region fill.
- **Custom plans → loop ring.** A ring divided into N segments (one per part),
  each in its `color`; completing a part fills its segment; a full ring = a
  completed cycle. Cycle counter shown in the center.

**Phase 2 — interactive (heavier, deferred):**
- **Hover** a body region / ring segment → tooltip lists the exercises done for
  that part this cycle.
- **Click** a region / segment → side panel opens with the related training log
  entries / records for that part in this loop.
- These interactions are explicitly Phase 2 per the user's decision ("一步一步来,
  先有,之后再做交互").

### 2.7 Bilingual
All plan names, part names, and custom tags go through the §5 translation
subsystem (zh ⇄ en, fitness-accurate). The 7 preset body parts reuse the fixed
taxonomy labels already defined.

---

## 3. Compact view (省流模式)

### 3.1 Concept
A toggle on the **Log / History** view. When ON, each day collapses to a
one-line summary: **what activities/parts were done + how many sets** — no
per-set weight/rep detail. When OFF, the full detailed view (current behavior).

### 3.2 Spec
- A view-layer toggle only; **no schema change**. Persist the preference locally
  (and optionally in `profile`/settings so it syncs).
- Compact row example: `06-19 · 胸 Chest · 4 exercises / 11 sets` or
  `06-16 · Frisbee 2h (L3) + 背 Back 3 sets`.
- One tap expands a compact day back to full detail.
- Bilingual like everything else.

---

## 4. Merge plan into main SPEC (when approved)
- §1 Activities → replaces `frisbee_entries` (§4.5) and the Frisbee screen text;
  add `activities`, `activity_levels`, `activity_entries`, `activity` tables to
  §4; update Dashboard frisbee charts to "by activity".
- §2 Split system → replaces main-spec §6B; adds the `split_*` and
  `cycle_progress` tables to §4; adds a Split screen to §7; adds body-model /
  loop-ring to §8 (Phase 1 static, Phase 2 interactive); extends build order.
- §3 Compact view → add to §7 (Log/History) and §8; no data model impact.
- All new tables carry `user_id` + RLS + sync fields per the main spec's global
  rule.
- Build order: Activities + Split skeleton (data model, editor, loop ring, static
  body model, auto/manual progress, compact view) land in **Phase 1**; body-model
  **hover/click interactions** land in **Phase 2** alongside the AI assistant.

---

## 5. Open questions / to revisit
- Hard-delete semantics for an activity that has historical records: current
  decision is soft-delete + hide; revisit if the user later wants true purge with
  an explicit "delete records too" confirmation.
- Whether custom plans should *optionally* also map to the body model when their
  parts happen to align with the 7 canonical parts (currently: custom = ring only,
  preset = body model). Easy to relax later.