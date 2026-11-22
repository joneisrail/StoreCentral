// A copy of the loaded env that never carries the real DATABASE_URL, so tests
// cannot reach the developer's database through it (see vitest.config.ts).
export function withoutDatabaseUrl(env: Record<string, string>): Record<string, string> {
  const copy = { ...env }
  delete copy.DATABASE_URL
  return copy
}
