import http from "node:http"
import type { AddressInfo } from "node:net"
import { Pool } from "pg"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest"
import { runMigrations } from "../db/migrate.js"
import { assertTestDatabase } from "../test-support/database-guard.js"
import { clearAmazonSettings, resolveAmazonSettings, saveAmazonSettings } from "../settings/amazon-settings.js"
import { createInternalHandler } from "./connections.js"

const KEY = "ab".repeat(32)
const TOKEN = "internal-bearer-token"
const REGION = "us-east-1"
const QUEUE = "https://sqs.us-east-1.amazonaws.com/123456789012/orders"
const CLIENT_ID = "amzn1.application-oa2-client.abc123"
const AWS_KEY_ID = "AKIA_DISTINCT_KEY_ID_9X"
const AWS_SECRET = "aws-distinct-secret-value-7Q"
const LWA_SECRET = "lwa-distinct-secret-value-3Z"
const NEW_SECRET = "new-distinct-secret-value-5K"
const SECRETS = [AWS_KEY_ID, AWS_SECRET, LWA_SECRET, NEW_SECRET, KEY, TOKEN]
const NO_ENV = {} as NodeJS.ProcessEnv

const FULL = {
  aws_region: REGION,
  sqs_queue_url: QUEUE,
  lwa_client_id: CLIENT_ID,
  aws_access_key_id: AWS_KEY_ID,
  aws_secret_access_key: AWS_SECRET,
  lwa_client_secret: LWA_SECRET,
}

describe("internal amazon settings API", () => {
  let pool: Pool
  let server: http.Server | undefined
  let base = ""
  let running = false
  let runtime: { apply: ReturnType<typeof vi.fn>; consumerRunning: ReturnType<typeof vi.fn> }
  let getQueueAttributes: ReturnType<typeof vi.fn>
  let makeSqs: ReturnType<typeof vi.fn>

  beforeAll(async () => {
    pool = new Pool({ connectionString: assertTestDatabase(process.env.TEST_DATABASE_URL) })
    await runMigrations(pool)
  }, 30_000)

  beforeEach(async () => {
    await clearAmazonSettings(pool)
    running = false
    runtime = {
      apply: vi.fn(async () => {
        running = true
      }),
      consumerRunning: vi.fn(() => running),
    }
    getQueueAttributes = vi.fn(async () => ({}))
    makeSqs = vi.fn(() => ({ getQueueAttributes }))
    const handler = createInternalHandler({
      pool,
      manager: {} as never,
      encryptionKey: KEY,
      secret: TOKEN,
      env: NO_ENV,
      amazon: { runtime, makeSqs: makeSqs as never },
    })
    server = http.createServer((req, res) => void handler(req, res))
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    const s = server
    server = undefined
    s?.closeAllConnections?.()
    if (s) await new Promise((r) => s.close(r))
  })

  afterAll(async () => {
    if (pool) await clearAmazonSettings(pool)
    await pool?.end()
  })

  const call = async (method: string, path: string, body?: unknown, auth: string | null = `Bearer ${TOKEN}`) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(auth ? { authorization: auth } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, text, json: text ? JSON.parse(text) : undefined }
  }
  const expectNoSecrets = (text: string) => {
    for (const s of SECRETS) expect(text).not.toContain(s)
  }

  test("401 without secret", async () => {
    const r = await call("GET", "/internal/amazon-settings", undefined, null)
    expect(r.status).toBe(401)
    const bad = await call("GET", "/internal/amazon-settings", undefined, "Bearer wrong")
    expect(bad.status).toBe(401)
  })

  test("405 wrong method", async () => {
    expect((await call("PUT", "/internal/amazon-settings", {})).status).toBe(405)
    expect((await call("GET", "/internal/amazon-settings/test")).status).toBe(405)
  })

  test("404 when the amazon dep is absent", async () => {
    const handler = createInternalHandler({
      pool,
      manager: {} as never,
      encryptionKey: KEY,
      secret: TOKEN,
      env: NO_ENV,
    })
    const s = http.createServer((req, res) => void handler(req, res))
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r))
    const port = (s.address() as AddressInfo).port
    const res = await fetch(`http://127.0.0.1:${port}/internal/amazon-settings`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(404)
    s.closeAllConnections?.()
    await new Promise((r) => s.close(r))
  })

  test("GET on empty settings shows none sources", async () => {
    const r = await call("GET", "/internal/amazon-settings")
    expect(r.status).toBe(200)
    expect(r.json.aws_region).toEqual({ value: null, source: "none" })
    expect(r.json.aws_access_key_id).toEqual({ set: false, source: "none" })
    expect(r.json.consumer_running).toBe(false)
  })

  test("GET never contains a secret and shows set flags and sources", async () => {
    await saveAmazonSettings(pool, KEY, {
      awsRegion: REGION,
      sqsQueueUrl: QUEUE,
      lwaClientId: CLIENT_ID,
      awsAccessKeyId: AWS_KEY_ID,
      awsSecretAccessKey: AWS_SECRET,
      lwaClientSecret: LWA_SECRET,
    })
    running = true
    const r = await call("GET", "/internal/amazon-settings")
    expect(r.status).toBe(200)
    expectNoSecrets(r.text)
    expect(r.json.aws_region).toEqual({ value: REGION, source: "database" })
    expect(r.json.sqs_queue_url).toEqual({ value: QUEUE, source: "database" })
    expect(r.json.lwa_client_id).toEqual({ value: CLIENT_ID, source: "database" })
    expect(r.json.aws_access_key_id).toEqual({ set: true, source: "database" })
    expect(r.json.aws_secret_access_key).toEqual({ set: true, source: "database" })
    expect(r.json.lwa_client_secret).toEqual({ set: true, source: "database" })
    expect(r.json.consumer_running).toBe(true)
  })

  test("POST saves and applies", async () => {
    const r = await call("POST", "/internal/amazon-settings", FULL)
    expect(r.status).toBe(200)
    expectNoSecrets(r.text)
    expect(runtime.apply).toHaveBeenCalledTimes(1)
    expect(r.json.aws_region).toEqual({ value: REGION, source: "database" })
    expect(r.json.lwa_client_secret).toEqual({ set: true, source: "database" })
    expect(r.json.consumer_running).toBe(true)
    const stored = await resolveAmazonSettings(pool, KEY, NO_ENV)
    expect(stored.awsKeys).toEqual({ accessKeyId: AWS_KEY_ID, secretAccessKey: AWS_SECRET })
  })

  test("POST blank keeps stored", async () => {
    await call("POST", "/internal/amazon-settings", FULL)
    const r = await call("POST", "/internal/amazon-settings", {
      aws_region: "eu-west-1",
      aws_access_key_id: "",
      aws_secret_access_key: "",
      lwa_client_secret: "",
    })
    expect(r.status).toBe(200)
    expect(r.json.aws_region.value).toBe("eu-west-1")
    expect(r.json.aws_access_key_id.set).toBe(true)
    const stored = await resolveAmazonSettings(pool, KEY, NO_ENV)
    expect(stored.awsKeys).toEqual({ accessKeyId: AWS_KEY_ID, secretAccessKey: AWS_SECRET })
    expect(stored.lwaClientSecret.value).toBe(LWA_SECRET)
  })

  test("POST half key pair is 422 naming the field not the value", async () => {
    const r = await call("POST", "/internal/amazon-settings", { aws_access_key_id: NEW_SECRET })
    expect(r.status).toBe(422)
    expect(r.json).toEqual({ error: "invalid_input", fields: ["awsSecretAccessKey"], kind: "missing" })
    expectNoSecrets(r.text)
    expect(runtime.apply).not.toHaveBeenCalled()
  })

  test("POST invalid value is 422 without echoing it", async () => {
    const bad = "not-a-region-" + NEW_SECRET
    const r = await call("POST", "/internal/amazon-settings", { aws_region: bad })
    expect(r.status).toBe(422)
    expect(r.json.fields).toEqual(["awsRegion"])
    expect(r.text).not.toContain(bad)
  })

  test("POST unknown or non-string key is 400", async () => {
    const a = await call("POST", "/internal/amazon-settings", { surprise: NEW_SECRET })
    expect(a.status).toBe(400)
    expectNoSecrets(a.text)
    const b = await call("POST", "/internal/amazon-settings", { aws_region: 5 })
    expect(b.status).toBe(400)
    const c = await call("POST", "/internal/amazon-settings", { __proto__x: "a", constructor: "b" })
    expect(c.status).toBe(400)
    expect(runtime.apply).not.toHaveBeenCalled()
  })

  test("POST over 64 KB is 413 and invalid JSON is 400", async () => {
    const big = await call("POST", "/internal/amazon-settings", { aws_region: "x".repeat(70 * 1024) })
    expect(big.status).toBe(413)
    const bad = await call("POST", "/internal/amazon-settings", "{not json" + NEW_SECRET)
    expect(bad.status).toBe(400)
    expectNoSecrets(bad.text)
  })

  test("DELETE clears and applies", async () => {
    await call("POST", "/internal/amazon-settings", FULL)
    runtime.apply.mockClear()
    const r = await call("DELETE", "/internal/amazon-settings")
    expect(r.status).toBe(200)
    expect(runtime.apply).toHaveBeenCalledTimes(1)
    expect(r.json.aws_region).toEqual({ value: null, source: "none" })
    expect(r.json.aws_access_key_id).toEqual({ set: false, source: "none" })
    expectNoSecrets(r.text)
  })

  test("test overlays unsaved values and persists nothing", async () => {
    await call("POST", "/internal/amazon-settings", { aws_region: REGION, sqs_queue_url: QUEUE })
    runtime.apply.mockClear()
    const otherQueue = "https://sqs.eu-west-1.amazonaws.com/123456789012/other"
    const r = await call("POST", "/internal/amazon-settings/test", {
      aws_region: "eu-west-1",
      sqs_queue_url: otherQueue,
      aws_access_key_id: AWS_KEY_ID,
      aws_secret_access_key: AWS_SECRET,
    })
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ ok: true })
    expect(makeSqs).toHaveBeenCalledWith({
      region: "eu-west-1",
      credentials: { accessKeyId: AWS_KEY_ID, secretAccessKey: AWS_SECRET },
    })
    expect(getQueueAttributes).toHaveBeenCalledWith({ QueueUrl: otherQueue })
    expect(runtime.apply).not.toHaveBeenCalled()
    const stored = await resolveAmazonSettings(pool, KEY, NO_ENV)
    expect(stored.awsRegion.value).toBe(REGION)
    expect(stored.sqsQueueUrl.value).toBe(QUEUE)
    expect(stored.awsKeys).toBeNull()
  })

  test("test with invalid overlay is 422 and half pair is 422", async () => {
    const a = await call("POST", "/internal/amazon-settings/test", { aws_region: "bad" + NEW_SECRET })
    expect(a.status).toBe(422)
    expect(a.json.fields).toEqual(["awsRegion"])
    expectNoSecrets(a.text)
    const b = await call("POST", "/internal/amazon-settings/test", { aws_secret_access_key: NEW_SECRET })
    expect(b.status).toBe(422)
    expect(b.json.fields).toEqual(["awsAccessKeyId"])
    expectNoSecrets(b.text)
    expect(makeSqs).not.toHaveBeenCalled()
  })

  test("test failure body has no secret", async () => {
    await call("POST", "/internal/amazon-settings", FULL)
    getQueueAttributes.mockRejectedValue(
      Object.assign(new Error(`denied ${AWS_SECRET} ${NEW_SECRET}`), { name: "AccessDenied" })
    )
    const r = await call("POST", "/internal/amazon-settings/test", { lwa_client_secret: NEW_SECRET })
    expect(r.status).toBe(200)
    expect(r.json.ok).toBe(false)
    expect(r.json.code).toBe("access_denied")
    expectNoSecrets(r.text)
  })

  test("test without configuration reports not_configured", async () => {
    const r = await call("POST", "/internal/amazon-settings/test", {})
    expect(r.status).toBe(200)
    expect(r.json.ok).toBe(false)
    expect(r.json.code).toBe("not_configured")
  })

  test("unknown subpath is 404", async () => {
    expect((await call("GET", "/internal/amazon-settings/nope")).status).toBe(404)
  })
})
