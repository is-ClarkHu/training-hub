// Legacy migration reference script (SPEC §10). Reads the user-provided CSV from
// raw_data/ (read-only) and writes the converted records to migration/out/ — never
// back into raw_data/. Idempotent: stable ids mean re-running overwrites cleanly.
//
// Run with Node's type stripping (Node ≥ 22.18):
//   node --experimental-strip-types migration/migrate.ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseLegacyCsv } from '../frontend/src/migration/parseLegacy.ts'

const here = dirname(fileURLToPath(import.meta.url))
const csvPath = resolve(here, '../raw_data/workout_log.csv')
const outDir = resolve(here, 'out')

const csv = readFileSync(csvPath, 'utf8')
const result = parseLegacyCsv(csv)

mkdirSync(outDir, { recursive: true })
const { report, ...records } = result
writeFileSync(resolve(outDir, 'records.json'), JSON.stringify(records, null, 2))
writeFileSync(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2))

console.log(
  `migrated: ${report.entries} entries, ${result.sets.length} sets, ${result.exercises.length} exercises, ` +
    `${report.sportSessions} sport sessions, ${report.skipped} skipped, ${report.needsReview.length} need review`,
)
console.log(`→ ${resolve(outDir, 'records.json')}`)
