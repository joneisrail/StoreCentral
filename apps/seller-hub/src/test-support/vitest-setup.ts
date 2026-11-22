import { assertTestDatabase } from "./database-guard.js"

// Runs before every test file. Tests only ever see a database through
// TEST_DATABASE_URL (which must end in _test). The real DATABASE_URL is never
// passed through, so a test that needs a database without one fails loudly
// instead of writing to the developer's real database.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = assertTestDatabase(process.env.TEST_DATABASE_URL)
} else {
  delete process.env.DATABASE_URL
}
