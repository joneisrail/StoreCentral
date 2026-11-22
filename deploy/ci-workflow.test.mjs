import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
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

const workflowUrl = new URL("../.github/workflows/ci.yml", import.meta.url)
const repoRoot = new URL("../", import.meta.url)
const workflow = parse(readFileSync(workflowUrl, "utf8"))
const jobs = workflow.jobs ?? {}
// YAML 1.1 parsers may turn the bare key `on` into `true`; accept both.
const triggers = workflow.on ?? workflow[true]

const stepsOf = (job) => jobs[job].steps ?? []
const allSteps = () => Object.entries(jobs).flatMap(([j, job]) => (job.steps ?? []).map((s) => [j, s]))
const envOf = (job) => ({
  ...(jobs[job].env ?? {}),
  ...Object.assign({}, ...stepsOf(job).map((s) => s.env ?? {})),
})

test("triggers are pull_request and push to main", () => {
  assert.ok(triggers, "missing on:")
  assert.ok("pull_request" in triggers)
  assert.deepEqual(triggers.push.branches, ["main"])
})

test("the six jobs exist", () => {
  for (const name of ["lint", "backend-unit", "backend-integration", "seller-hub", "images", "deploy-config"]) {
    assert.ok(jobs[name], `missing job ${name}`)
  }
})

test("permissions are read-only and runs are cancelled when superseded", () => {
  assert.deepEqual(workflow.permissions, { contents: "read" })
  assert.equal(workflow.concurrency["cancel-in-progress"], true)
})

test("working-directory values exist in the repo", () => {
  for (const [job, step] of allSteps()) {
    const dir = step["working-directory"]
    if (!dir) continue
    assert.ok(existsSync(new URL(`${dir}/`, repoRoot)), `${job}: ${dir} does not exist`)
  }
  const defaults = Object.values(jobs).map((j) => j.defaults?.run?.["working-directory"]).filter(Boolean)
  for (const dir of defaults) assert.ok(existsSync(new URL(`${dir}/`, repoRoot)), `${dir} does not exist`)
})

test("third-party actions are pinned to a major version tag", () => {
  for (const [job, step] of allSteps()) {
    if (!step.uses) continue
    assert.match(step.uses, /^[\w.-]+\/[\w./-]+@v\d+$/, `${job}: ${step.uses}`)
  }
})

test("seller-hub job points TEST_DATABASE_URL at a _test database and has Redis", () => {
  const env = envOf("seller-hub")
  assert.match(env.TEST_DATABASE_URL, /\/[A-Za-z0-9_]+_test$/)
  assert.ok(env.REDIS_URL, "REDIS_URL missing")
  assert.ok(jobs["seller-hub"].services.redis)
  assert.ok(jobs["seller-hub"].services.postgres)
})

test("backend-integration job has Postgres 15, Redis and its env", () => {
  const job = jobs["backend-integration"]
  assert.match(job.services.postgres.image, /^postgres:15/)
  assert.ok(job.services.redis)
  const env = envOf("backend-integration")
  for (const key of ["DB_HOST", "DB_USERNAME", "DB_PASSWORD", "REDIS_TEST_URL"]) {
    assert.ok(env[key], `${key} missing`)
  }
  const runs = stepsOf("backend-integration").map((s) => s.run ?? "").join("\n")
  assert.match(runs, /test:integration:modules/)
  assert.match(runs, /test:integration:http/)
})

test("service containers have health checks", () => {
  for (const job of ["backend-integration", "seller-hub"]) {
    for (const [name, svc] of Object.entries(jobs[job].services)) {
      assert.match(String(svc.options), /--health-cmd/, `${job}/${name}`)
    }
  }
})

test("every job installs with --immutable after enabling corepack", () => {
  for (const [name, job] of Object.entries(jobs)) {
    if (name === "images") continue
    const runs = (job.steps ?? []).map((s) => s.run ?? "")
    const corepack = runs.findIndex((r) => /corepack enable/.test(r))
    const install = runs.findIndex((r) => /yarn install --immutable/.test(r))
    assert.ok(corepack >= 0 && install > corepack, `${name}: corepack enable then yarn install --immutable`)
  }
})

test("deploy-config runs the deploy tests after an install step", () => {
  const runs = stepsOf("deploy-config").map((s) => s.run ?? "")
  const install = runs.findIndex((r) => /yarn install/.test(r))
  const test = runs.findIndex((r) => /node --test deploy\/\*\.test\.mjs/.test(r))
  assert.ok(install >= 0 && test > install)
})

test("images job builds four Dockerfiles from the repo root with no push", () => {
  const runs = stepsOf("images").map((s) => s.run ?? "").join("\n")
  for (const name of ["backend", "seller-hub", "storefront", "pos"]) {
    assert.match(runs, new RegExp(String.raw`docker build .*-f deploy/${name}\.Dockerfile .*\.(\s|$)`))
  }
  assert.doesNotMatch(runs, /docker push|--push/)
  // next.config.js runs check-env-variables.js, which exits when the
  // publishable key is empty, so the storefront build needs dummy build args.
  const storefront = runs.split("\n").find((l) => /storefront\.Dockerfile/.test(l))
  assert.match(storefront, /--build-arg NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=\S+/)
  assert.match(storefront, /--build-arg NEXT_PUBLIC_MEDUSA_BACKEND_URL=\S+/)
  assert.match(runs, /docker compose -f deploy\/docker-compose\.yml --env-file \S+ config -q/)
})

test("no step prints environment values", () => {
  for (const [job, step] of allSteps()) {
    const run = step.run ?? ""
    assert.doesNotMatch(run, /(^|[\s;&|])(env|printenv|set)(\s*$|\s*[;&|])/m, `${job}: prints env`)
    assert.doesNotMatch(run, /\bprintenv\b/, `${job}: printenv`)
    assert.doesNotMatch(run, /\$\{\{\s*secrets\./, `${job}: uses secrets`)
    assert.doesNotMatch(run, /set -x|xtrace/, `${job}: xtrace`)
  }
})
