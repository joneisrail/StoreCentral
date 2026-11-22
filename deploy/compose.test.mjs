import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"

// `yaml` is not a declared dependency of this repo. It is a transitive
// dependency that yarn hoists to the root node_modules, so we resolve it from
// the repo root and fail with one clear message if it is missing.
let parse
try {
  parse = createRequire(new URL("../package.json", import.meta.url))("yaml").parse
} catch {
  throw new Error(
    "Cannot load the yaml package. Run yarn install at the repo root first: yaml is a transitive dependency hoisted to the root node_modules (CI runs this test after yarn install).",
  )
}

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8")
const compose = parse(read("./docker-compose.yml"))
const caddyfile = read("./Caddyfile")
const dockerignore = read("../.dockerignore")
const services = compose.services ?? {}

const NODE_SERVICES = ["migrate", "backend", "seller-hub", "storefront", "pos"]

const toList = (env) =>
  Array.isArray(env)
    ? env.map((entry) => {
        const i = entry.indexOf("=")
        return i === -1 ? [entry, ""] : [entry.slice(0, i), entry.slice(i + 1)]
      })
    : Object.entries(env ?? {})

// Literal (non-reference) values that are known to be non-secret.
const LITERAL_ALLOWLIST = new Set([
  "NODE_ENV",
  "BACKEND_REDIS_MODULES",
  "SELLER_HUB_INTERNAL_URL",
  "SELLER_HUB_WEBHOOK_URL",
  "MEDUSA_BACKEND_URL",
  "PORT",
  "HOSTNAME",
  "WEBHOOK_PORT",
  "NEXT_TELEMETRY_DISABLED",
  "NODE_OPTIONS",
])

test("the expected services exist", () => {
  for (const name of [
    "postgres",
    "redis",
    "migrate",
    "backend",
    "seller-hub",
    "storefront",
    "pos",
    "caddy",
  ]) {
    assert.ok(services[name], `missing service ${name}`)
  }
})

test("only caddy publishes ports, and only 80 and 443", () => {
  for (const [name, svc] of Object.entries(services)) {
    if (name === "caddy") continue
    assert.equal(svc.ports, undefined, `${name} must not publish ports`)
  }
  const published = services.caddy.ports.map((p) => String(p))
  assert.ok(published.some((p) => /(^|:)80:80(\/|$)/.test(p)))
  assert.ok(published.some((p) => /(^|:)443:443(\/|$)/.test(p)))
  const tcpOrUdp443 = published.filter((p) => /(^|:)443:443(\/|$)/.test(p))
  assert.equal(published.length, 1 + tcpOrUdp443.length)
})

test("no environment value is a secret literal", () => {
  for (const [name, svc] of Object.entries(services)) {
    for (const [key, value] of toList(svc.environment)) {
      const text = String(value ?? "")
      if (text.includes("${")) continue
      assert.ok(
        LITERAL_ALLOWLIST.has(key),
        `${name}: ${key} has a literal value and is not on the allowlist`,
      )
    }
  }
})

test("required secrets use the required-variable form", () => {
  const env = Object.fromEntries(toList(services.backend.environment))
  for (const key of ["JWT_SECRET", "COOKIE_SECRET", "SELLER_HUB_INTERNAL_SECRET"]) {
    assert.match(String(env[key]), /\$\{[A-Z_]+:\?/, `${key} must use the :? form`)
  }
})

test("every node service runs check-env then its start command", () => {
  for (const name of NODE_SERVICES) {
    const svc = services[name]
    const entry = [svc.entrypoint, svc.command]
      .flat()
      .filter((x) => typeof x === "string")
      .join(" ")
    const target = name === "migrate" ? "backend" : name
    assert.ok(
      entry.includes(`node deploy/check-env.mjs ${target} &&`),
      `${name} must run "node deploy/check-env.mjs ${target} &&"`,
    )
  }
})

test("postgres and redis have named data volumes", () => {
  assert.ok(Object.hasOwn(compose.volumes ?? {}, "postgres-data"))
  assert.ok(Object.hasOwn(compose.volumes ?? {}, "redis-data"))
  assert.ok(services.postgres.volumes.some((v) => v.startsWith("postgres-data:")))
  assert.ok(services.redis.volumes.some((v) => v.startsWith("redis-data:")))
})

test("restart policy and memory placeholder", () => {
  for (const [name, svc] of Object.entries(services)) {
    if (name === "migrate") {
      assert.equal(svc.restart, "no")
    } else {
      assert.equal(svc.restart, "unless-stopped", `${name} restart`)
    }
  }
})

const toMb = (limit) => {
  const m = /^(\d+)([mg])$/.exec(String(limit))
  assert.ok(m, `unparseable mem_limit ${limit}`)
  return Number(m[1]) * (m[2] === "g" ? 1024 : 1)
}

const MEM_FLOORS_MB = {
  backend: 1024,
  migrate: 1024,
  storefront: 512,
  "seller-hub": 384,
  pos: 128,
  caddy: 128,
  postgres: 512,
  redis: 128,
}

test("every service has a mem_limit at or above its floor", () => {
  for (const [name, svc] of Object.entries(services)) {
    assert.ok(svc.mem_limit, `${name} needs a mem_limit`)
    assert.ok(
      toMb(svc.mem_limit) >= MEM_FLOORS_MB[name],
      `${name} mem_limit ${svc.mem_limit} is below its floor`,
    )
  }
  const text = read("./docker-compose.yml")
  assert.doesNotMatch(text, /set by Task 9/)
  assert.match(text, /measured dev peak \+ 25 percent, floor applied/)
})

test("every node service caps the heap below its mem_limit", () => {
  for (const name of NODE_SERVICES) {
    const svc = services[name]
    const env = Object.fromEntries(toList(svc.environment))
    const m = /--max-old-space-size=(\d+)/.exec(String(env.NODE_OPTIONS ?? ""))
    assert.ok(m, `${name} must set NODE_OPTIONS=--max-old-space-size=<MB>`)
    assert.ok(
      Number(m[1]) < toMb(svc.mem_limit),
      `${name} heap cap ${m[1]} must be below mem_limit ${svc.mem_limit}`,
    )
  }
})

test("dependency conditions", () => {
  const cond = (svc, dep) => services[svc].depends_on?.[dep]?.condition
  assert.equal(cond("migrate", "postgres"), "service_healthy")
  assert.equal(cond("backend", "postgres"), "service_healthy")
  assert.equal(cond("backend", "redis"), "service_healthy")
  assert.equal(cond("backend", "migrate"), "service_completed_successfully")
  assert.equal(cond("seller-hub", "postgres"), "service_healthy")
  assert.equal(cond("seller-hub", "redis"), "service_healthy")
  assert.equal(cond("seller-hub", "backend"), "service_healthy")
  assert.equal(cond("caddy", "backend"), "service_healthy")
  assert.equal(cond("caddy", "seller-hub"), "service_healthy")
})

test("every service has a healthcheck except migrate", () => {
  for (const [name, svc] of Object.entries(services)) {
    if (name === "migrate") continue
    assert.ok(svc.healthcheck?.test, `${name} needs a healthcheck`)
  }
})

test("backend and seller-hub wiring", () => {
  const be = Object.fromEntries(toList(services.backend.environment))
  assert.equal(be.BACKEND_REDIS_MODULES, "true")
  assert.equal(be.SELLER_HUB_INTERNAL_URL, "http://seller-hub:7005")
  assert.equal(be.SELLER_HUB_WEBHOOK_URL, "http://seller-hub:7005")
  assert.match(be.REDIS_URL, /@redis:6379/)
  assert.match(be.DATABASE_URL, /@postgres:5432\/.*sslmode=disable/)
  const sh = Object.fromEntries(toList(services["seller-hub"].environment))
  assert.equal(sh.MEDUSA_BACKEND_URL, "http://backend:9000")
  assert.match(sh.REDIS_URL, /@redis:6379/)
  const mig = Object.fromEntries(toList(services.migrate.environment))
  assert.equal(mig.BACKEND_REDIS_MODULES, "true")
})

test("storefront public URL is a build arg and a runtime env", () => {
  const args = Object.fromEntries(toList(services.storefront.build.args))
  assert.ok("NEXT_PUBLIC_MEDUSA_BACKEND_URL" in args)
  const env = Object.fromEntries(toList(services.storefront.environment))
  assert.ok("NEXT_PUBLIC_MEDUSA_BACKEND_URL" in env)
})

test("services build from the repo root with their own Dockerfile", () => {
  for (const [name, file] of [
    ["backend", "backend"],
    ["seller-hub", "seller-hub"],
    ["storefront", "storefront"],
    ["pos", "pos"],
  ]) {
    const b = services[name].build
    assert.equal(b.context, "..", `${name} context`)
    assert.equal(b.dockerfile, `deploy/${file}.Dockerfile`)
  }
})

test("exactly one service builds the backend image and migrate reuses it", () => {
  const builders = Object.entries(services).filter(
    ([, svc]) => svc.build?.dockerfile === "deploy/backend.Dockerfile",
  )
  assert.deepEqual(builders.map(([name]) => name), ["backend"])
  assert.equal(services.migrate.build, undefined)
  assert.equal(services.migrate.image, services.backend.image)
  assert.equal(services.migrate.pull_policy, "never")
})

test("caddyfile never routes the internal api", () => {
  assert.equal(caddyfile.includes("/internal"), false)
})

test("caddyfile hub host proxies only webhooks and 404s the rest", () => {
  const start = caddyfile.indexOf("{$HUB_HOST}")
  assert.ok(start >= 0, "HUB_HOST block missing")
  const rest = caddyfile.slice(start)
  const block = rest.slice(0, rest.indexOf("\n}") + 2)
  assert.match(block, /handle \/webhooks\/\*\s*\{\s*reverse_proxy seller-hub:7005\s*\}/)
  assert.match(block, /handle\s*\{\s*respond 404\s*\}/)
  assert.equal((block.match(/reverse_proxy/g) ?? []).length, 1)
})

test("caddyfile routes the other hosts", () => {
  assert.match(caddyfile, /\{\$STORE_HOST\}\s*\{\s*reverse_proxy storefront:8000/)
  assert.match(caddyfile, /\{\$ADMIN_HOST\}\s*\{\s*reverse_proxy backend:9000/)
  assert.match(caddyfile, /\{\$POS_HOST\}\s*\{\s*reverse_proxy pos:8001/)
})

test("dockerignore keeps env files out of the build context", () => {
  const lines = dockerignore.split(/\r?\n/).map((l) => l.trim())
  for (const want of [
    "**/.env",
    "**/.env.*",
    "!**/.env.template",
    "!**/.env.example",
    ".git",
    "node_modules",
    ".worktrees",
    ".superpowers",
    ".turbo",
    ".yarn/cache",
    "apps/backend/.medusa",
    ".next",
    "dist",
  ]) {
    assert.ok(lines.includes(want), `.dockerignore missing ${want}`)
  }
})

test("env example has names and non-secret defaults only", () => {
  const text = read("./.env.example")
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue
    assert.doesNotMatch(line, /change-?me|supersecret|your-/i)
  }
})
