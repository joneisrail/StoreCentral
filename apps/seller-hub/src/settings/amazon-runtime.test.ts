import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { Pool } from "pg"
import { createAmazonRuntime, type SqsFactory } from "./amazon-runtime.js"

const KEY = "ab".repeat(32)
const QUEUE = "https://sqs.us-east-1.amazonaws.com/123456789012/orders"

const emptyPool = (): Pool => ({ query: async () => ({ rows: [] }) }) as unknown as Pool

type Made = {
  cfg: Parameters<SqsFactory>[0]
  receives: number
}

const setup = (envInit: NodeJS.ProcessEnv, pool: Pool = emptyPool()) => {
  const env = { ...envInit }
  const made: Made[] = []
  const makeSqs: SqsFactory = (cfg) => {
    const entry: Made = { cfg, receives: 0 }
    made.push(entry)
    return {
      receiveMessage: async () => {
        entry.receives += 1
        return { Messages: [] }
      },
      deleteMessage: async () => undefined,
      getQueueAttributes: async () => ({}),
    }
  }
  const runtime = createAmazonRuntime({
    pool,
    encryptionKey: KEY,
    env,
    makeSqs,
    onOrderChange: async () => undefined,
  })
  return { env, made, runtime }
}

describe("amazon runtime", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, "log").mockImplementation(() => undefined)
    vi.spyOn(console, "error").mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  test("starts a consumer when region and queue url are set", async () => {
    const { runtime, made } = setup({ AWS_REGION: "us-east-1", SQS_QUEUE_URL: QUEUE })
    await runtime.apply()
    expect(runtime.consumerRunning()).toBe(true)
    expect(made).toHaveLength(1)
    expect(made[0]!.cfg.region).toBe("us-east-1")
    await vi.advanceTimersByTimeAsync(1_100)
    expect(made[0]!.receives).toBe(1)
  })

  test("does not start when not configured and logs once", async () => {
    const { runtime, made } = setup({})
    await runtime.apply()
    expect(runtime.consumerRunning()).toBe(false)
    expect(made).toHaveLength(0)
    expect(console.log).toHaveBeenCalledTimes(1)
  })

  test("apply twice replaces the consumer and stops the old one (exactly one running)", async () => {
    const { runtime, made } = setup({ AWS_REGION: "us-east-1", SQS_QUEUE_URL: QUEUE })
    await Promise.all([runtime.apply(), runtime.apply()])
    await runtime.apply()
    expect(made).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(1_100)
    expect(made.map((m) => m.receives)).toEqual([0, 0, 1])
    expect(runtime.consumerRunning()).toBe(true)
  })

  test("stopping when settings are cleared", async () => {
    const { runtime, made, env } = setup({ AWS_REGION: "us-east-1", SQS_QUEUE_URL: QUEUE })
    await runtime.apply()
    delete env.SQS_QUEUE_URL
    await runtime.apply()
    expect(runtime.consumerRunning()).toBe(false)
    await vi.advanceTimersByTimeAsync(2_100)
    expect(made[0]!.receives).toBe(0)
  })

  test("credentials passed only when a key pair exists", async () => {
    const base = { AWS_REGION: "us-east-1", SQS_QUEUE_URL: QUEUE }
    const without = setup(base)
    await without.runtime.apply()
    expect(without.made[0]!.cfg.credentials).toBeNull()

    const withKeys = setup({ ...base, AWS_ACCESS_KEY_ID: "AKIAENV", AWS_SECRET_ACCESS_KEY: "env-secret" })
    await withKeys.runtime.apply()
    expect(withKeys.made[0]!.cfg.credentials).toEqual({
      accessKeyId: "AKIAENV",
      secretAccessKey: "env-secret",
    })
  })

  test("onApplied is called with the resolved settings on each apply", async () => {
    const seen: string[] = []
    const env = { AWS_REGION: "us-east-1", SQS_QUEUE_URL: QUEUE, AMAZON_LWA_CLIENT_ID: "id-1" }
    const runtime = createAmazonRuntime({
      pool: emptyPool(),
      encryptionKey: KEY,
      env,
      makeSqs: () => ({
        receiveMessage: async () => ({}),
        deleteMessage: async () => undefined,
        getQueueAttributes: async () => ({}),
      }),
      onApplied: (s) => seen.push(s.lwaClientId.value ?? "none"),
      onOrderChange: async () => undefined,
    })
    await runtime.apply()
    env.AMAZON_LWA_CLIENT_ID = "id-2"
    await runtime.apply()
    expect(seen).toEqual(["id-1", "id-2"])
  })

  test("onApplied error does not break apply or consumer start", async () => {
    const env = { AWS_REGION: "us-east-1", SQS_QUEUE_URL: QUEUE }
    const runtime = createAmazonRuntime({
      pool: emptyPool(),
      encryptionKey: KEY,
      env,
      makeSqs: () => ({
        receiveMessage: async () => ({}),
        deleteMessage: async () => undefined,
        getQueueAttributes: async () => ({}),
      }),
      onApplied: () => {
        throw new Error("boom hunter2")
      },
      onOrderChange: async () => undefined,
    })
    await expect(runtime.apply()).resolves.toBeUndefined()
    expect(runtime.consumerRunning()).toBe(true)
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("hunter2")
  })

  test("keeps the running consumer when resolve fails and does not call onApplied", async () => {
    let fail = false
    const pool = {
      query: async () => {
        if (fail) throw new Error("db down")
        return { rows: [] }
      },
    } as unknown as Pool
    const onApplied = vi.fn()
    const env = { AWS_REGION: "us-east-1", SQS_QUEUE_URL: QUEUE }
    const runtime = createAmazonRuntime({
      pool,
      encryptionKey: KEY,
      env,
      makeSqs: () => ({
        receiveMessage: async () => ({}),
        deleteMessage: async () => undefined,
        getQueueAttributes: async () => ({}),
      }),
      onApplied,
      onOrderChange: async () => undefined,
    })
    await runtime.apply()
    expect(onApplied).toHaveBeenCalledTimes(1)
    fail = true
    await runtime.apply()
    expect(runtime.consumerRunning()).toBe(true)
    expect(onApplied).toHaveBeenCalledTimes(1)
  })

  test("apply swallows errors and never throws", async () => {
    const pool = {
      query: async () => {
        throw new Error("connection string postgres://user:hunter2@host")
      },
    } as unknown as Pool
    const { runtime } = setup({}, pool)
    await expect(runtime.apply()).resolves.toBeUndefined()
    expect(runtime.consumerRunning()).toBe(false)
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls)
    expect(logged).not.toContain("hunter2")
  })
})
