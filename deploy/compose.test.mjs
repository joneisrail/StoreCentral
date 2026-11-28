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

// A site block ends at the first closing brace in column 0; nested blocks are
// tab-indented, so their braces never match.
const hostBlock = (host) => {
  const start = caddyfile.indexOf(`{$${host}} {`)
  assert.ok(start >= 0, `${host} block missing`)
  const rest = caddyfile.slice(start)
  return rest.slice(0, rest.search(/\n\}/) + 2)
}

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
  "MEILI_ENV",
  "MEILI_NO_ANALYTICS",
  "MEILISEARCH_HOST",
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
  for (const key of [
    "JWT_SECRET",
    "COOKIE_SECRET",
    "SELLER_HUB_INTERNAL_SECRET",
    "MEILISEARCH_API_KEY",
  ]) {
    assert.match(String(env[key]), /\$\{[A-Z_]+:\?/, `${key} must use the :? form`)
  }
})

test("optional AWS keys are references, not literals, and not required", () => {
  const env = Object.fromEntries(toList(services["seller-hub"].environment))
  for (const key of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]) {
    assert.equal(env[key], `\${${key}:-}`)
  }
})

test("seller-hub Amazon variables are optional references, not required", () => {
  const env = Object.fromEntries(toList(services["seller-hub"].environment))
  for (const key of ["AWS_REGION", "SQS_QUEUE_URL", "AMAZON_LWA_CLIENT_ID", "AMAZON_LWA_CLIENT_SECRET"]) {
    assert.equal(env[key], `\${${key}:-}`, `${key} must use the :- form`)
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

test("restart policy", () => {
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
  meilisearch: 512,
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
  assert.match(text, /# floor value; dev measurement is a lower bound, revisit after the first compose run/)
})

test("every node service caps the heap at 75 percent of its mem_limit", () => {
  for (const name of NODE_SERVICES) {
    const svc = services[name]
    const env = Object.fromEntries(toList(svc.environment))
    const m = /--max-old-space-size=(\d+)/.exec(String(env.NODE_OPTIONS ?? ""))
    assert.ok(m, `${name} must set NODE_OPTIONS=--max-old-space-size=<MB>`)
    assert.equal(
      Number(m[1]),
      Math.floor(0.75 * toMb(svc.mem_limit)),
      `${name} heap cap must be 75 percent of mem_limit ${svc.mem_limit}`,
    )
  }
})

test("dependency conditions", () => {
  const cond = (svc, dep) => services[svc].depends_on?.[dep]?.condition
  assert.equal(cond("migrate", "postgres"), "service_healthy")
  assert.equal(cond("backend", "postgres"), "service_healthy")
  assert.equal(cond("backend", "redis"), "service_healthy")
  assert.equal(cond("backend", "migrate"), "service_completed_successfully")
  // The backend loads the Meilisearch provider at boot (and migrate runs the
  // search index migration plan), so both wait for a healthy Meilisearch.
  assert.equal(cond("migrate", "meilisearch"), "service_healthy")
  assert.equal(cond("backend", "meilisearch"), "service_healthy")
  assert.equal(cond("migrate", "redis"), "service_healthy")
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

test("storefront image origin is an optional build arg and runtime env", () => {
  const args = Object.fromEntries(toList(services.storefront.build.args))
  const env = Object.fromEntries(toList(services.storefront.environment))
  for (const [where, map] of [["build arg", args], ["environment", env]]) {
    assert.equal(map.NEXT_PUBLIC_IMAGE_ORIGIN, "${NEXT_PUBLIC_IMAGE_ORIGIN:-}", `${where} must use the :- form`)
  }
  const dockerfile = read("./storefront.Dockerfile")
  assert.match(dockerfile, /^ARG NEXT_PUBLIC_IMAGE_ORIGIN$/m)
  assert.match(dockerfile, /NEXT_PUBLIC_IMAGE_ORIGIN=\$NEXT_PUBLIC_IMAGE_ORIGIN/)
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
  assert.match(hostBlock("STORE_HOST"), /reverse_proxy storefront:8000/)
  const admin = hostBlock("ADMIN_HOST")
  assert.equal((admin.match(/reverse_proxy backend:9000/g) ?? []).length, 2)
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

test("storefront mounts a persistent optimiser cache volume", () => {
  assert.ok(Object.hasOwn(compose.volumes ?? {}, "storefront-image-cache"))
  assert.ok(
    services.storefront.volumes.includes("storefront-image-cache:/app/apps/storefront/.next/cache"),
  )
})

test("storefront image Dockerfile creates the cache dir for node before USER node", () => {
  const dockerfile = read("./storefront.Dockerfile")
  const dir = "/app/apps/storefront/.next/cache"
  const user = dockerfile.indexOf("\nUSER node")
  assert.ok(user >= 0, "USER node missing")
  const before = dockerfile.slice(0, user)
  assert.ok(before.includes(`mkdir -p ${dir}`), "cache dir must be created before USER node")
  assert.ok(before.includes(`chown -R node:node ${dir}`), "cache dir must be chowned before USER node")
})

test("caddyfile storefront host compresses and never adds a second Cache-Control", () => {
  const block = hostBlock("STORE_HOST")
  assert.match(block, /encode zstd gzip/)
  assert.doesNotMatch(block.replace(/^\s*#.*$/gm, ""), /Cache-Control/i)
})

test("caddyfile admin host caches product images under /static", () => {
  const block = hostBlock("ADMIN_HOST")
  assert.match(
    block,
    /handle \/static\/\*\s*\{\s*reverse_proxy backend:9000\s*\{\s*header_down Cache-Control "public, max-age=2678400"\s*\}\s*\}/,
  )
})
