// The relay is hosted on a free tier that sleeps after ~15 min idle, so the first
// request after a nap blocks ~1 minute on a cold start. Without a word from the UI
// that looks like a hang. This flips true only once a request has already been
// slow, so a warm relay (the common case) never shows the notice.
import { useEffect, useState } from 'react'

export const COLD_START_HINT_MS = 3000

export function useSlowHint(active: boolean, delayMs = COLD_START_HINT_MS): boolean {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!active) { setSlow(false); return }
    const t = setTimeout(() => setSlow(true), delayMs)
    return () => clearTimeout(t)
  }, [active, delayMs])
  return slow
}
