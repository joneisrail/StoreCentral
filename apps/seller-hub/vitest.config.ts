import { loadEnv } from "vite"
import { defineConfig } from "vitest/config"

export default defineConfig(({ mode }) => {
  // Load apps/seller-hub/.env (and friends) into process.env so tests that
  // call loadEnv() — e.g. the migration test, which runs against the real
  // local Postgres — see real connection values instead of nothing.
  process.env = { ...process.env, ...loadEnv(mode, process.cwd(), "") }

  return {
    test: {
      include: ["src/**/*.test.ts"],
    },
  }
})
