// Demo-account seeder. Signs in AS the demo user (anon key — no service_role), wipes
// its rows across every table + storage bucket, then inserts a full showcase dataset.
// Re-run daily by .github/workflows/seed-demo.yml so the demo always looks current.
//
//   DRY RUN (no network):  node --experimental-strip-types seed.ts
//   REAL:  SUPABASE_URL=… SUPABASE_ANON_KEY=… DEMO_EMAIL=… DEMO_PASSWORD=… node --experimental-strip-types seed.ts
//
// Run from frontend/ so @supabase/supabase-js resolves.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { stamp, UID_TOKEN, type Asset } from './util.ts'
import { exerciseRows } from './data/exercises.ts'
import { sportRows, sportSessionRows } from './data/sports.ts'
import { buildTraining } from './data/routine.ts'
import { buildInjuries } from './data/injuries.ts'
import { buildProfile } from './data/profile.ts'
import { buildFood } from './data/food.ts'
import { buildFiles } from './data/files.ts'
import { buildChatrooms } from './data/chatrooms.ts'
import { translationRows } from './data/translations.ts'

type Row = Record<string, unknown>

// Every user-data table, in a safe insert order: parents before children, because
// real cross-table FKs exist (sets.entry_id, workout_entries.exercise_id and
// .injury_id, sport_sessions.sport_id). Wipe walks the same list in reverse, so this
// order also has to be a safe delete order read backwards.
const INSERT_ORDER = [
  'exercises', 'sports', 'injuries', 'training_cycle', 'cycle_rounds',
  'workout_entries', 'sets', 'entry_cycle_assignments', 'sport_sessions',
  'basics', 'body_measurements', 'notes', 'supplements', 'training_env',
  'medical_background', 'food_log', 'public_files',
  'chatrooms', 'chat_messages', 'chatroom_summaries', 'chatroom_memories',
  'chatroom_memory_access', 'chatroom_file_access',
  'optional_trackers', 'translation_dictionary', 'insights', 'profile',
] as const
const STORAGE_BUCKETS = ['food-photos', 'public-files', 'injury-photos']

/** Assemble every table's rows (without user_id — stamped at insert) + storage assets. */
function build(): { tables: Record<string, Row[]>; assets: Asset[] } {
  const t = buildTraining()
  const inj = buildInjuries()
  const prof = buildProfile()
  const food = buildFood()
  const files = buildFiles()
  const chat = buildChatrooms(files.ids)
  const tables: Record<string, Row[]> = {
    exercises: exerciseRows(),
    sports: sportRows(),
    sport_sessions: sportSessionRows(),
    training_cycle: t.cycles,
    cycle_rounds: t.rounds,
    workout_entries: [...t.entries, ...inj.entries],
    sets: [...t.sets, ...inj.sets],
    entry_cycle_assignments: t.assignments,
    injuries: inj.injuries,
    profile: prof.profile,
    basics: prof.basics,
    body_measurements: prof.body_measurements,
    notes: prof.notes,
    supplements: prof.supplements,
    training_env: prof.training_env,
    medical_background: prof.medical_background,
    food_log: food.food_log,
    public_files: files.public_files,
    chatrooms: chat.chatrooms,
    chat_messages: chat.chat_messages,
    chatroom_summaries: chat.chatroom_summaries,
    chatroom_memories: chat.chatroom_memories,
    chatroom_memory_access: chat.chatroom_memory_access,
    chatroom_file_access: chat.chatroom_file_access,
    translation_dictionary: translationRows(),
  }
  return { tables, assets: [...food.assets, ...files.assets] }
}

async function wipe(sb: SupabaseClient, uid: string): Promise<void> {
  for (const table of [...INSERT_ORDER].reverse()) {
    const { error } = await sb.from(table).delete().eq('user_id', uid)
    if (error) console.warn(`  wipe ${table}: ${error.message}`)
  }
  for (const bucket of STORAGE_BUCKETS) {
    const { data } = await sb.storage.from(bucket).list(uid)
    if (data && data.length) {
      const paths = data.map((f) => `${uid}/${f.name}`)
      await sb.storage.from(bucket).remove(paths)
    }
  }
}

// Storage paths are folder-per-user; swap the placeholder for the real uid.
function resolveUid(rows: Row[], uid: string, field: string): Row[] {
  return rows.map((r) => (typeof r[field] === 'string' ? { ...r, [field]: (r[field] as string).replace(UID_TOKEN, uid) } : r))
}

async function insertAll(sb: SupabaseClient, uid: string, tables: Record<string, Row[]>): Promise<void> {
  for (const table of INSERT_ORDER) {
    let rows = tables[table]
    if (!rows || rows.length === 0) continue
    if (table === 'food_log') rows = resolveUid(rows, uid, 'photo_path')
    if (table === 'public_files') rows = resolveUid(rows, uid, 'storage_path')
    const stamped = stamp(rows, uid)
    for (let i = 0; i < stamped.length; i += 500) {
      const { error } = await sb.from(table).insert(stamped.slice(i, i + 500))
      if (error) throw new Error(`insert ${table}: ${error.message}`)
    }
    console.log(`  ${table}: ${rows.length}`)
  }
}

async function uploadAssets(sb: SupabaseClient, uid: string, assets: Asset[]): Promise<void> {
  for (const a of assets) {
    const path = a.path.replace(UID_TOKEN, uid)
    const body = typeof a.body === 'string' ? new Blob([a.body], { type: a.contentType }) : new Blob([a.body], { type: a.contentType })
    const { error } = await sb.storage.from(a.bucket).upload(path, body, { contentType: a.contentType, upsert: true })
    if (error) console.warn(`  upload ${a.bucket}/${path}: ${error.message}`)
  }
  if (assets.length) console.log(`  storage assets: ${assets.length}`)
}

async function main(): Promise<void> {
  const { tables, assets } = build()
  const total = Object.values(tables).reduce((n, r) => n + r.length, 0)

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY
  const email = process.env.DEMO_EMAIL
  const password = process.env.DEMO_PASSWORD

  const missing = Object.entries({ SUPABASE_URL: url, SUPABASE_ANON_KEY: key, DEMO_EMAIL: email, DEMO_PASSWORD: password })
    .filter(([, v]) => !v)
    .map(([k]) => k)

  if (missing.length > 0) {
    // On CI a missing secret must FAIL. Falling through to the dry run there is a
    // silent no-op: the job reports success every night while the demo account
    // quietly goes stale, which is worse than the red X.
    if (process.env.CI) {
      throw new Error(`missing ${missing.join(', ')} — add them as repo secrets (see scripts/seed-demo/README.md)`)
    }
    console.log(`DRY RUN (missing ${missing.join(', ')} — set them to seed for real).\n`)
    console.log('Rows that WOULD be written:')
    for (const [t, r] of Object.entries(tables)) console.log(`  ${t.padEnd(24)} ${r.length}`)
    console.log(`  ${'TOTAL'.padEnd(24)} ${total}`)
    console.log(`  ${'storage assets'.padEnd(24)} ${assets.length}`)
    return
  }

  const sb = createClient(url, key, { auth: { persistSession: false } })
  const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email, password })
  if (authErr || !auth.user) throw new Error(`sign-in failed: ${authErr?.message ?? 'no user'}`)
  const uid = auth.user.id
  console.log(`Signed in as demo user ${uid}`)

  console.log('Wiping previous demo data…')
  await wipe(sb, uid)
  console.log('Inserting fresh demo data…')
  await insertAll(sb, uid, tables)
  await uploadAssets(sb, uid, assets)
  console.log(`Done. ${total} rows + ${assets.length} assets seeded.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
