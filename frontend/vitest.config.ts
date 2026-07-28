import { defineConfig } from 'vitest/config'

// Unit tests run in a plain Node environment — the suites under test are pure logic
// (sync cursor math, monotonic clock) with no DOM, Supabase, or Dexie dependency.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
