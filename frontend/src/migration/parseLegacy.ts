// Legacy CSV → new schema (SPEC §10). The reference parser for messy human input.
// Pure & self-contained (only type-only imports) so it runs in the browser (in-app
// import) and under Node (migration/migrate.ts) unchanged. Idempotent: ids are
// derived from stable seeds, so re-importing upserts rather than duplicates.
import type { BodyPart, MeasureType, SportField } from '../supabase/types'

// ── deterministic UUIDv5-shaped id from a seed (stable across runs) ──
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0]
}
function seededUuid(seed: string): string {
  const [a, b, c, d] = cyrb128(seed)
  const hx = (n: number) => (n >>> 0).toString(16).padStart(8, '0')
  const h = hx(a) + hx(b) + hx(c) + hx(d)
  const ver = '5' + h.slice(13, 16)
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${ver}-${variant}-${h.slice(20, 32)}`
}

// ── output shapes (business fields; importer stamps user_id/updated_at) ──
export interface DraftExercise {
  id: string; name_zh: string; name_en: string; body_part: BodyPart
  measure_type: MeasureType; assisted: boolean; is_custom: boolean
  name_locked: boolean; needs_translation: boolean; default_per_side: boolean; deleted: boolean
}
export interface DraftEntry {
  id: string; date: string; exercise_id: string; is_superset: boolean
  superset_group: null; note_raw: string; note_tags: string[]
  cycle_day_label: null; injury_modified: null; injury_id: null
  needs_review: boolean; needs_translation: boolean; deleted: boolean
}
export interface SubVal { weight: number | null; reps: number | null; duration_sec: number | null }
export interface DraftSet {
  id: string; entry_id: string; set_index: number
  set_type: 'normal' | 'superset' | 'dropset'
  weight: number | null; reps: number | null; duration_sec: number | null
  per_side: boolean; sub_sets: SubVal[]; deleted: boolean
}
export interface DraftSport {
  id: string; name_zh: string; name_en: string; is_default: boolean
  name_locked: boolean; needs_translation: boolean; fields: SportField[]; deleted: boolean
}
export interface DraftSportSession {
  id: string; date: string; sport_id: string; hours: number
  attributes: Record<string, string>
  injury: boolean; note_raw: string; note_tags: string[]; deleted: boolean
}
export interface ParseReport {
  totalRows: number; entries: number; sportSessions: number; skipped: number
  needsReview: { date: string; exercise: string; raw: string; reason: string }[]
}
export interface ParseResult {
  exercises: DraftExercise[]; entries: DraftEntry[]; sets: DraftSet[]
  sports: DraftSport[]; sportSessions: DraftSportSession[]; report: ParseReport
}

const FRISBEE_MIGRATION_FIELDS: SportField[] = [
  {
    key: 'level', label_zh: '等级', label_en: 'Level', type: 'select',
    options: [
      { value: 'toss', zh: '抛接', en: 'Toss' },
      { value: 'casual', zh: '休闲', en: 'Casual' },
      { value: 'club', zh: '俱乐部', en: 'Club' },
      { value: 'major', zh: '大赛', en: 'Major' },
    ],
  },
]
const TIER_TO_LEVEL: Record<number, string> = { 1: 'toss', 2: 'casual', 3: 'club', 4: 'major' }

// 部位/分类 → one of the 7 body parts. activation/stretch/recovery are NOT body
// parts (§4.1) — they become note tags and the entry is flagged for review.
const CATEGORY_BODY_PART: Record<string, BodyPart> = {
  '胸/上肢': 'chest', '胸': 'chest', '上肢': 'chest',
  '背': 'back', '肩': 'shoulders', '腿': 'legs',
  '手臂': 'arms', '二头': 'arms', '三头': 'arms', '核心': 'core', '腹': 'core',
}
const NON_BODYPART_TAGS: Record<string, string> = {
  '激活': 'activation', '拉伸': 'skipped_stretch', '恢复': 'rehab', '康复': 'rehab',
}

function classifyCategory(cat: string): { bodyPart: BodyPart; tag: string | null; review: boolean } {
  if (cat in CATEGORY_BODY_PART) return { bodyPart: CATEGORY_BODY_PART[cat], tag: null, review: false }
  if (cat in NON_BODYPART_TAGS) return { bodyPart: 'core', tag: NON_BODYPART_TAGS[cat], review: true }
  return { bodyPart: 'core', tag: null, review: true }
}

function splitCsvLine(line: string): string[] {
  const parts = line.split(',')
  if (parts.length <= 8) return parts
  return [...parts.slice(0, 7), parts.slice(7).join(',')] // note may contain commas
}

function parseDurationToken(tok: string): number | null {
  const t = tok.trim()
  if (t.includes(':')) {
    const seg = t.split(':').map((x) => parseInt(x, 10) || 0)
    return seg.length === 3 ? seg[0] * 3600 + seg[1] * 60 + seg[2] : seg[0] * 60 + seg[1]
  }
  const m = t.match(/([\d.]+)\s*分钟?/)
  if (m) return Math.round(parseFloat(m[1]) * 60)
  const h = t.match(/([\d.]+)\s*小时/)
  if (h) return Math.round(parseFloat(h[1]) * 3600)
  return null
}

// Infer a frisbee tier (1 toss · 2 casual/pickup · 3 club/league · 4 major/comp)
// from the legacy "动作"/备注/类型 text.
function frisbeeTier(text: string): 1 | 2 | 3 | 4 {
  const s = text.toLowerCase()
  if (/regional|比赛|major|nationals|赛事|大学|sectionals/.test(s)) return 4
  if (/联赛|league|训练|俱乐部|club/.test(s)) return 3
  if (/toss|抛接/.test(s)) return 1
  if (/pickup|娱乐|casual|沙滩|beach|尔湾|mix|初/.test(s)) return 2
  return 2
}

interface ParsedSet { subs: SubVal[]; set_type: 'normal' | 'superset' | 'dropset' }

// Parse one "a×b" (or "a×b×c…") token → sub-set(s). weight = first, reps follow.
function subsFromToken(tok: string): SubVal[] {
  const parts = tok.split('×').map((x) => x.trim()).filter(Boolean)
  if (parts.length === 0) return []
  const w = parseFloat(parts[0])
  const weight = Number.isNaN(w) ? null : w
  if (parts.length === 1) return [{ weight, reps: null, duration_sec: null }]
  // weight × rep1 × rep2 … → multiple sub-sets at the same weight
  return parts.slice(1).map((r) => ({ weight, reps: parseInt(r, 10) || null, duration_sec: null }))
}

// Detect + parse the superset formats, e.g.
//   超级组(25×13+20×13);(27.5×8+20×10);(25×10+20×10)   → 3 superset sets
//   超级组(17.5×13+10×13)×2                              → 2 identical superset sets
//   22.5×15;32.5×12;超级组(37.5×8+32.5×8)                → 2 normal + 1 superset
// Returns null when the body isn't a superset shape.
function parseSuperset(body: string, dropset: boolean): ParsedSet[] | null {
  if (!/超级组|\)\s*[;；]?\s*\(/.test(body) && !/超级组?\(/.test(body)) return null
  const type: 'superset' | 'dropset' = dropset ? 'dropset' : 'superset'
  const out: ParsedSet[] = []
  for (let seg of body.split(/[;；]/)) {
    seg = seg.trim()
    if (!seg) continue
    let repeat = 1
    const rep = seg.match(/[)）]\s*×\s*(\d+)\s*$/)
    if (rep) { repeat = parseInt(rep[1], 10) || 1; seg = seg.replace(/×\s*\d+\s*$/, '').trim() }
    const paren = seg.match(/[(（]([^)）]*)[)）]/)
    if (paren) {
      // one superset set: sub-sets separated by '+'
      const subs = paren[1].split('+').flatMap((t) => subsFromToken(t)).filter((s) => s.weight !== null || s.reps !== null)
      if (subs.length) for (let r = 0; r < repeat; r++) out.push({ subs, set_type: type })
    } else {
      const clean = seg.replace(/超级组/g, '').trim()
      const subs = subsFromToken(clean).filter((s) => s.weight !== null || s.reps !== null)
      if (subs.length) for (let r = 0; r < repeat; r++) out.push({ subs, set_type: 'normal' })
    }
  }
  return out.length ? out : null
}

export function parseLegacyCsv(csv: string): ParseResult {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim().length > 0)
  const exercises = new Map<string, DraftExercise>()
  const entries: DraftEntry[] = []
  const sets: DraftSet[] = []
  const sportSessions: DraftSportSession[] = []
  const report: ParseReport = { totalRows: 0, entries: 0, sportSessions: 0, skipped: 0, needsReview: [] }
  const occ = new Map<string, number>() // (date|exercise) → occurrence count

  const frisbeeId = seededUuid('sport:frisbee')
  const sports: DraftSport[] = [{
    id: frisbeeId, name_zh: '飞盘', name_en: 'Frisbee', is_default: true,
    name_locked: false, needs_translation: false, fields: FRISBEE_MIGRATION_FIELDS, deleted: false,
  }]

  for (let i = 1; i < lines.length; i++) {
    const [date, type, category = '', name = '', weightRaw = '', cell = '', _total = '', note = ''] = splitCsvLine(lines[i])
    void _total
    if (!date || !name) continue
    report.totalRows++
    const raw = cell.trim()

    // Frisbee / sport sessions (§4.5). Any 飞盘* type (飞盘, 飞盘比赛, …) is a sport,
    // never a gym exercise. The legacy "动作" column encodes the tier.
    if (type.includes('飞盘')) {
      const tier = frisbeeTier(`${name} ${note} ${type}`)
      let hours = (parseDurationToken(raw) ?? 0) / 3600
      let estimated = !raw.includes(':')
      if (raw.includes('天')) {
        const days = parseInt(raw, 10) || (/[一二两]/.test(raw) ? 1 : 1)
        hours = (days || 1) * 6 // tournament day ≈ 6h
        estimated = true
      }
      void estimated
      sportSessions.push({
        id: seededUuid(`sport_session:${date}:${name}:${i}`),
        date, sport_id: frisbeeId, hours: hours || 1.5,
        attributes: { level: TIER_TO_LEVEL[tier] },
        injury: /拉伤|受伤|⚠️/.test(note),
        note_raw: [name, note].filter(Boolean).join(' · '), // keep "夏季联赛" etc as the session label
        note_tags: [], deleted: false,
      })
      report.sportSessions++
      continue
    }

    // Skip markers ("-", "(跳过拉伸)")
    if (raw === '-' || raw === '' || name.startsWith('(') || name.startsWith('（')) {
      report.skipped++
      continue
    }

    const { bodyPart, tag, review: catReview } = classifyCategory(category)
    const noteTags: string[] = tag ? [tag] : []
    let needsReview = catReview

    // per-side prefix
    let body = raw
    let perSide = false
    if (/^(每侧|两边各|每边|各)/.test(body)) {
      perSide = true
      if (!noteTags.includes('per_side')) noteTags.push('per_side')
      body = body.replace(/^(每侧|两边各|每边|各)/, '').trim()
    }
    const weight = weightRaw.trim() ? parseFloat(weightRaw) : null

    // decide measure type + parse sets
    let measureType: MeasureType = 'weight_reps'
    const setRows: { weight: number | null; reps: number | null; duration_sec: number | null }[] = []
    let parsedSets: ParsedSet[] | null = null

    // Superset / dropset (multi-sub-set) — try first; body has 超级组 or (a+b) groups.
    const isDropset = /递减/.test(note) || /递减/.test(body)
    const superset = weight !== null || /×/.test(body) ? parseSuperset(body, isDropset) : null
    if (superset) {
      measureType = 'weight_reps'
      parsedSets = superset
    }

    const isDuration = !parsedSets && (/[:分秒]|小时/.test(body) || /[:分秒]/.test(raw))
    if (parsedSets) {
      // already parsed above
    } else if (isDuration) {
      measureType = 'duration'
      if (/共|组/.test(body)) {
        // "2组共2.5分钟" / "1组" — ambiguous split across sets
        const d = parseDurationToken(body)
        setRows.push({ weight: null, reps: null, duration_sec: d })
        needsReview = true
      } else if (body.includes('×')) {
        const [countStr, durStr] = body.split('×')
        const count = parseInt(countStr, 10) || 1
        const d = parseDurationToken(durStr)
        for (let n = 0; n < count; n++) setRows.push({ weight: null, reps: null, duration_sec: d })
      } else {
        const d = parseDurationToken(body)
        setRows.push({ weight: null, reps: null, duration_sec: d })
        if (perSide) needsReview = true
      }
    } else if (body.includes('×')) {
      // weight×reps×reps… — weight from the column, else embedded as the first token
      measureType = 'weight_reps'
      const segs = body.split('×')
      const w = weight ?? (parseFloat(segs[0]) || null)
      const repSegs = weight != null ? segs : segs.slice(1)
      for (const r of repSegs) setRows.push({ weight: w, reps: parseInt(r, 10) || null, duration_sec: null })
      if (repSegs.length === 0) needsReview = true
    } else if (weight != null && body.includes('/')) {
      measureType = 'weight_reps'
      for (const w of body.split('/')) setRows.push({ weight: parseFloat(w) || weight, reps: null, duration_sec: null })
      needsReview = true
    } else if (weight != null) {
      measureType = 'weight_reps'
      for (const r of body.split('+')) setRows.push({ weight, reps: parseInt(r, 10) || null, duration_sec: null })
    } else {
      // bodyweight reps
      measureType = 'reps_only'
      for (const tok of body.split('+')) {
        const r = parseInt(tok, 10)
        if (Number.isNaN(r)) { needsReview = true; continue }
        setRows.push({ weight: null, reps: r, duration_sec: null })
      }
      if (setRows.length === 0) { setRows.push({ weight: null, reps: null, duration_sec: null }); needsReview = true }
    }

    // canonical exercise (exact-name dedup → one library row, §10)
    const canon = name.trim()
    const exId = seededUuid(`exercise:${canon}`)
    if (!exercises.has(canon)) {
      // Movements that are inherently per-side (unilateral) — used as the default toggle.
      const perSideMovement = perSide || /单腿|单臂|单侧|保加利亚|弓步|分腿|箭步|侧平举|哑铃.*(弯举|推举)/.test(canon)
      exercises.set(canon, {
        id: exId, name_zh: canon, name_en: '', body_part: bodyPart, measure_type: measureType,
        assisted: /助力|辅助/.test(canon), is_custom: true, name_locked: false,
        needs_translation: true, default_per_side: perSideMovement, deleted: false,
      })
    } else if (perSide) {
      const ex = exercises.get(canon)!
      if (!ex.default_per_side) ex.default_per_side = true // learn from any per-side occurrence
    }

    const occKey = `${date}|${canon}`
    const n = (occ.get(occKey) ?? 0) + 1
    occ.set(occKey, n)
    const entryId = seededUuid(`entry:${date}:${canon}:${n}`)
    // Unify: either the superset-parsed sets, or the flat setRows as single-sub sets.
    const finalSets: ParsedSet[] =
      parsedSets ?? setRows.map((s) => ({ subs: [s], set_type: 'normal' as const }))
    const hasSuperset = finalSets.some((s) => s.set_type !== 'normal')

    entries.push({
      id: entryId, date, exercise_id: exId, is_superset: hasSuperset, superset_group: null,
      note_raw: note, note_tags: noteTags, cycle_day_label: null, injury_modified: null,
      injury_id: null, needs_review: needsReview, needs_translation: false, deleted: false,
    })
    report.entries++
    finalSets.forEach((ps, idx) => {
      const [primary, ...rest] = ps.subs
      sets.push({
        id: seededUuid(`set:${entryId}:${idx + 1}`), entry_id: entryId, set_index: idx + 1,
        set_type: ps.set_type, weight: primary.weight ?? null, reps: primary.reps ?? null,
        duration_sec: primary.duration_sec ?? null, per_side: perSide, sub_sets: rest, deleted: false,
      })
    })
    if (needsReview) report.needsReview.push({ date, exercise: canon, raw, reason: catReview ? 'category not a body part' : 'ambiguous sets/reps' })
  }

  return {
    exercises: [...exercises.values()], entries, sets, sports, sportSessions, report,
  }
}
