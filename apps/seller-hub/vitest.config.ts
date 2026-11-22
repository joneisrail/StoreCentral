import { loadEnv } from "vite"
import { defineConfig } from "vitest/config"

export default defineConfig(({ mode }) => {
  // Load apps/seller-hub/.env (and friends) into process.env so tests see the
  // other connection values (Redis, Medusa, keys). The real DATABASE_URL is
  // never let through: src/test-support/vitest-setup.ts replaces it with
  // TEST_DATABASE_URL (guarded to a *_test database) or removes it.
  const { DATABASE_URL: _realDatabaseUrl, ...envWithoutDatabaseUrl } = loadEnv(
    mode,
    process.cwd(),
    ""
  )
  process.env = { ...process.env, ...envWithoutDatabaseUrl }

  return {
    test: {
      include: ["src/**/*.test.ts"],
      setupFiles: ["./src/test-support/vitest-setup.ts"],
    },
  }
})
