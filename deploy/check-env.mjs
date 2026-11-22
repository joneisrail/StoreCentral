import { readFileSync, realpathSync } from "node:fs"
import { fileURLToPath } from "node:url"

const MIN_SECRET_LENGTH = 32
const PLACEHOLDERS = ["change-me", "changeme", "supersecret", "your-"]

const config = JSON.parse(
  readFileSync(new URL("./required-env.json", import.meta.url), "utf8"),
)

const isSet = (value) => typeof value === "string" && value !== ""

/**
 * Check an environment against deploy/required-env.json.
 * Problems carry variable names only, never values.
 */
export function checkEnv(service, env, opts = {}) {
  const spec = Object.hasOwn(config, service) ? config[service] : undefined
  if (!spec) {
    throw new Error(`unknown service: ${service}`)
  }
  const production = opts.production ?? env.NODE_ENV === "production"

  const required = new Set(spec.required ?? [])
  for (const rule of spec.requiredWhen ?? []) {
    const active = Object.entries(rule.when).every(([k, v]) => env[k] === v)
    if (active) required.add(rule.name)
  }
  if (production) {
    for (const name of spec.requiredInProduction ?? []) required.add(name)
  }

  const secrets = new Set(spec.secrets ?? [])
  const problems = []
  for (const name of new Set([...required, ...secrets])) {
    const value = env[name]
    if (!isSet(value)) {
      if (required.has(name)) problems.push(`${name}: missing`)
      continue
    }
    const lower = value.toLowerCase()
    if (PLACEHOLDERS.some((p) => lower.includes(p))) {
      problems.push(`${name}: placeholder value`)
    } else if (secrets.has(name) && value.length < MIN_SECRET_LENGTH) {
      problems.push(`${name}: shorter than ${MIN_SECRET_LENGTH} characters`)
    }
  }
  return { ok: problems.length === 0, problems }
}

function main() {
  const service = process.argv[2]
  let result
  try {
    result = checkEnv(service, process.env)
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
  const production = process.env.NODE_ENV === "production"
  if (result.ok) {
    console.log(`${service}: configuration ok`)
    return
  }
  const stream = production ? console.error : console.warn
  for (const problem of result.problems) stream(problem)
  if (production) process.exit(1)
  console.warn(`${service}: ${result.problems.length} warning(s), not production`)
}

// Run main() only when this file is the entry point. argv[1] may be relative
// or a symlink, so compare real paths (import.meta.url is already resolved).
const entry = process.argv[1]
if (entry && realpathSync(entry) === fileURLToPath(import.meta.url)) {
  main()
}
