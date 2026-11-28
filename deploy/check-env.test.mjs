import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkEnv } from "./check-env.mjs"

const script = fileURLToPath(new URL("./check-env.mjs", import.meta.url))
const strong = (tag) => `SENTINEL-VALUE-${tag}-`.padEnd(40, "x")

function backendEnv(extra = {}) {
  return {
    DATABASE_URL: "postgres://SENTINEL-VALUE-db@localhost/db",
    JWT_SECRET: strong("jwt"),
    COOKIE_SECRET: strong("cookie"),
    STORE_CORS: "http://localhost:8000",
    ADMIN_CORS: "http://localhost:9000",
    AUTH_CORS: "http://localhost:9000",
    SELLER_HUB_INTERNAL_URL: "http://localhost:3001",
    SELLER_HUB_WEBHOOK_URL: "http://localhost:3001/hook",
    SELLER_HUB_INTERNAL_SECRET: strong("internal"),
    MEILISEARCH_API_KEY: strong("meili"),
    ...extra,
  }
}

test("a complete backend env is ok", () => {
  const r = checkEnv("backend", backendEnv())
  assert.deepEqual(r, { ok: true, problems: [] })
})

test("missing required name is reported", () => {
  const env = backendEnv()
  delete env.STORE_CORS
  const r = checkEnv("backend", env)
  assert.equal(r.ok, false)
  assert.deepEqual(r.problems, ["STORE_CORS: missing"])
})

test("31 character secret is reported, 32 passes", () => {
  const short = checkEnv("backend", backendEnv({ JWT_SECRET: "a".repeat(31) }))
  assert.deepEqual(short.problems, ["JWT_SECRET: shorter than 32 characters"])
  const ok = checkEnv("backend", backendEnv({ JWT_SECRET: "a".repeat(32) }))
  assert.equal(ok.ok, true)
})

test("placeholders are reported even when long enough", () => {
  for (const v of [
    "change-me-please-long-enough-xxxxxxxx",
    "CHANGEME-please-long-enough-xxxxxxxxxx",
    "my-SuperSecret-value-long-enough-xxxxxxx",
    "your-secret-value-long-enough-xxxxxxxxx",
  ]) {
    const r = checkEnv("backend", backendEnv({ COOKIE_SECRET: v }))
    assert.deepEqual(r.problems, ["COOKIE_SECRET: placeholder value"], v)
  }
})

test("optional secret is checked only when set", () => {
  assert.equal(checkEnv("backend", backendEnv()).ok, true)
  const r = checkEnv("backend", backendEnv({ AUTH_MFA_ENCRYPTION_KEY: "short" }))
  assert.deepEqual(r.problems, ["AUTH_MFA_ENCRYPTION_KEY: shorter than 32 characters"])
})

test("MEILISEARCH_API_KEY is a required backend secret", () => {
  const env = backendEnv()
  delete env.MEILISEARCH_API_KEY
  assert.deepEqual(checkEnv("backend", env).problems, ["MEILISEARCH_API_KEY: missing"])
  const short = checkEnv("backend", backendEnv({ MEILISEARCH_API_KEY: "a".repeat(16) }))
  assert.deepEqual(short.problems, ["MEILISEARCH_API_KEY: shorter than 32 characters"])
})

test("REDIS_URL is required only when BACKEND_REDIS_MODULES is true", () => {
  assert.equal(checkEnv("backend", backendEnv({ BACKEND_REDIS_MODULES: "false" })).ok, true)
  const r = checkEnv("backend", backendEnv({ BACKEND_REDIS_MODULES: "true" }))
  assert.deepEqual(r.problems, ["REDIS_URL: missing"])
})

test("seller-hub: marketplace credentials are optional", () => {
  const env = {
    DATABASE_URL: "x", REDIS_URL: "x", MEDUSA_BACKEND_URL: "x",
    MEDUSA_ADMIN_EMAIL: "a@b.c", MEDUSA_ADMIN_PASSWORD: strong("pw"),
    ENCRYPTION_KEY: strong("enc"), AWS_REGION: "us-east-1", SQS_QUEUE_URL: "x",
    AMAZON_LWA_CLIENT_ID: "x", AMAZON_LWA_CLIENT_SECRET: "x",
    SELLER_HUB_INTERNAL_SECRET: strong("internal"),
  }
  assert.equal(checkEnv("seller-hub", env, { production: true }).ok, true)
  const r = checkEnv("seller-hub", { ...env, SELLER_HUB_INTERNAL_SECRET: undefined }, { production: true })
  assert.deepEqual(r.problems, ["SELLER_HUB_INTERNAL_SECRET: missing"])
  assert.equal(checkEnv("seller-hub", { ...env, SELLER_HUB_INTERNAL_SECRET: undefined }, { production: false }).ok, true)
})

test("seller-hub: the Amazon variables are optional, each one missing or all missing", () => {
  const base = {
    DATABASE_URL: "x", REDIS_URL: "x", MEDUSA_BACKEND_URL: "x",
    MEDUSA_ADMIN_EMAIL: "a@b.c", MEDUSA_ADMIN_PASSWORD: strong("pw"),
    ENCRYPTION_KEY: strong("enc"), SELLER_HUB_INTERNAL_SECRET: strong("internal"),
  }
  const amazon = ["AWS_REGION", "SQS_QUEUE_URL", "AMAZON_LWA_CLIENT_ID", "AMAZON_LWA_CLIENT_SECRET"]
  assert.deepEqual(checkEnv("seller-hub", base, { production: true }), { ok: true, problems: [] })
  for (const name of amazon) {
    const env = Object.fromEntries(amazon.filter((n) => n !== name).map((n) => [n, "x"]))
    assert.equal(checkEnv("seller-hub", { ...base, ...env }, { production: true }).ok, true, name)
  }
})

test("storefront public values have no length rule; pos has no requirements", () => {
  const env = {
    NEXT_PUBLIC_MEDUSA_BACKEND_URL: "x", NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY: "pk",
    NEXT_PUBLIC_BASE_URL: "x", NEXT_PUBLIC_DEFAULT_REGION: "us",
  }
  assert.equal(checkEnv("storefront", env).ok, true)
  assert.equal(checkEnv("pos", {}).ok, true)
})

test("problems never contain values", () => {
  const env = backendEnv({
    JWT_SECRET: "SENTINEL-VALUE-short",
    COOKIE_SECRET: "SENTINEL-VALUE-change-me-" + "y".repeat(30),
  })
  const r = checkEnv("backend", env)
  assert.equal(r.problems.length, 2)
  assert.ok(!JSON.stringify(r).includes("SENTINEL-VALUE"))
})

test("unknown service throws a names-only message", () => {
  assert.throws(() => checkEnv("nope", {}), /unknown service: nope/)
})

function runCli(args, env) {
  return spawnSync(process.execPath, [script, ...args], {
    env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, ...env },
    encoding: "utf8",
  })
}

test("cli: production with problems exits 1 and prints names only", () => {
  const r = runCli(["backend"], { NODE_ENV: "production", JWT_SECRET: "SENTINEL-VALUE-short" })
  assert.equal(r.status, 1)
  assert.match(r.stdout + r.stderr, /JWT_SECRET: shorter than 32 characters/)
  assert.match(r.stdout + r.stderr, /STORE_CORS: missing/)
  assert.ok(!(r.stdout + r.stderr).includes("SENTINEL-VALUE"))
})

test("cli: non-production warns and exits 0", () => {
  const r = runCli(["backend"], { NODE_ENV: "development", JWT_SECRET: "SENTINEL-VALUE-short" })
  assert.equal(r.status, 0)
  assert.match(r.stdout + r.stderr, /STORE_CORS: missing/)
  assert.ok(!(r.stdout + r.stderr).includes("SENTINEL-VALUE"))
})

test("cli: unknown service exits 1", () => {
  const r = runCli(["bogus"], {})
  assert.equal(r.status, 1)
  assert.match(r.stdout + r.stderr, /unknown service: bogus/)
})

test("cli: production with complete env exits 0", () => {
  const r = runCli(["pos"], { NODE_ENV: "production" })
  assert.equal(r.status, 0)
})

test("cli: runs when invoked by a relative path from another directory", () => {
  // The main-module guard must compare real paths, not argv[1] text, or a
  // relative invocation silently does nothing and exits 0.
  const r = spawnSync(process.execPath, ["../deploy/check-env.mjs", "backend"], {
    cwd: fileURLToPath(new URL("../docs/", import.meta.url)),
    env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, NODE_ENV: "production" },
    encoding: "utf8",
  })
  assert.equal(r.status, 1)
  assert.match(r.stdout + r.stderr, /STORE_CORS: missing/)
})

test("cli: runs when invoked through a symlink", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "check-env-link-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const link = join(dir, "check-env-link.mjs")
  try {
    symlinkSync(script, link)
  } catch {
    t.skip("cannot create a symlink on this system")
    return
  }
  const r = spawnSync(process.execPath, [link, "backend"], {
    env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, NODE_ENV: "production" },
    encoding: "utf8",
  })
  assert.equal(r.status, 1)
  assert.match(r.stdout + r.stderr, /STORE_CORS: missing/)
})
