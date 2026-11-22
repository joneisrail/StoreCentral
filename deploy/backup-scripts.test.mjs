import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const restore = fileURLToPath(new URL("./restore.sh", import.meta.url))
const backup = fileURLToPath(new URL("./backup.sh", import.meta.url))

const probe = spawnSync("sh", ["-c", "exit 0"])
const skip = probe.error ? "sh was not found on PATH" : false

function runRestore(dump, target) {
  const r = spawnSync("sh", [restore, dump, target], { encoding: "utf8" })
  return { status: r.status, text: `${r.stdout}${r.stderr}` }
}

for (const name of ["storecentral", "postgres", "prod_restore_old"]) {
  test(`restore refuses target ${name} before touching anything`, { skip }, () => {
    const dump = "some-secret-location/somefile.dump"
    const r = runRestore(dump, name)
    assert.equal(r.status, 2)
    assert.match(r.text, /_restore|_test/)
    assert.ok(!r.text.includes(dump), "message must not echo the dump path")
    assert.ok(!/postgres:\/\//.test(r.text), "no connection string")
  })
}

for (const name of ["Prod_restore", "a-b_restore", "-x_restore", "x_restore;y", "x y_restore"]) {
  test(`restore refuses bypass name ${JSON.stringify(name)}`, { skip }, () => {
    const dump = "some-secret-location/somefile.dump"
    const r = runRestore(dump, name)
    assert.equal(r.status, 2)
    assert.ok(!r.text.includes(name), "message must not echo the name")
    assert.ok(!r.text.includes(dump), "message must not echo the dump path")
  })
}

test("backup.sh sets an owner-only umask before writing", () => {
  const text = readFileSync(backup, "utf8")
  const u = text.indexOf("umask 077")
  assert.ok(u !== -1 && u < text.indexOf("mkdir -p"))
})

test("restore with a valid name and a missing dump fails about the dump", { skip }, () => {
  const r = runRestore("no-such-dir/missing.dump", "x_restore")
  assert.notEqual(r.status, 0)
  assert.notEqual(r.status, 2)
  assert.match(r.text, /dump file not found/)
  assert.ok(!/docker/i.test(r.text), "must fail before any docker call")
})

test("restore checks the name before any docker call", () => {
  const text = readFileSync(restore, "utf8")
  const guard = text.indexOf('case "$target" in')
  const firstDocker = text.indexOf("docker compose")
  assert.ok(guard !== -1 && firstDocker !== -1)
  assert.ok(guard < firstDocker)
  const fileCheck = text.indexOf("-f ")
  assert.ok(fileCheck !== -1 && fileCheck < firstDocker)
})

test("backup.sh keeps the password inside the container and prints no env", () => {
  const text = readFileSync(backup, "utf8")
  const lines = text.split("\n").filter((l) => !l.trim().startsWith("#"))
  for (const line of lines.filter((l) => l.includes("PGPASSWORD="))) {
    assert.match(line, /PGPASSWORD="\$POSTGRES_PASSWORD"/)
    assert.match(text, /exec -T.* postgres sh -c/, "assignment belongs to a container command")
  }
  assert.ok(!/^\s*(env|printenv|set -x)\b/m.test(text))
  assert.ok(!/echo .*PASSWORD/i.test(text))
  assert.ok(text.includes("--format=custom"))
  assert.ok(text.includes("set -eu"))
})
