// Small shared helpers for the local-first data layer.
import { v4 as uuidv4 } from 'uuid'

/** Client-generated UUID for new rows (SPEC §3). */
export function newId(): string {
  return uuidv4()
}

/** ISO8601 timestamp for `updated_at` (client-controlled; last-write-wins). */
export function nowIso(): string {
  return new Date().toISOString()
}

/** Local 'YYYY-MM-DD' for date columns (defaults to today). */
export function today(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
