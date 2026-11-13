import { callSellerHub, SellerHubError } from "../seller-hub-client"

const env = {
  SELLER_HUB_INTERNAL_URL: "http://hub:7005//",
  SELLER_HUB_INTERNAL_SECRET: "s3cret-value",
} as unknown as NodeJS.ProcessEnv

const reply = (status: number, body: unknown) =>
  jest.fn(async () => ({
    status,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch

const failure = async (p: Promise<unknown>): Promise<SellerHubError> => {
  try {
    await p
  } catch (e) {
    return e as SellerHubError
  }
  throw new Error("expected rejection")
}

describe("callSellerHub", () => {
  it("sends the bearer secret to the trimmed URL and returns status and body", async () => {
    const fetchImpl = reply(200, { ok: true })
    const out = await callSellerHub(
      "PUT",
      "/internal/connections/shopify",
      { a: "b" },
      { fetchImpl, env }
    )
    expect(out).toEqual({ status: 200, body: { ok: true } })
    const [url, init] = (fetchImpl as unknown as jest.Mock).mock.calls[0]
    expect(url).toBe("http://hub:7005/internal/connections/shopify")
    expect(init.method).toBe("PUT")
    expect(init.headers.authorization).toBe("Bearer s3cret-value")
    expect(init.body).toBe(JSON.stringify({ a: "b" }))
  })

  it("maps missing configuration to 503", async () => {
    for (const missing of ["SELLER_HUB_INTERNAL_URL", "SELLER_HUB_INTERNAL_SECRET"]) {
      const e = { ...env, [missing]: undefined } as NodeJS.ProcessEnv
      const err = await failure(
        callSellerHub("GET", "/x", undefined, { fetchImpl: reply(200, {}), env: e })
      )
      expect(err.status).toBe(503)
      expect(err.message).toBe("Marketplace connections are not configured")
    }
  })

  it("maps network failure to 502 without leaking the secret", async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error("boom s3cret-value")
    }) as unknown as typeof fetch
    const err = await failure(callSellerHub("GET", "/x", undefined, { fetchImpl, env }))
    expect(err.status).toBe(502)
    expect(err.message).toBe("Cannot reach seller-hub")
    expect(JSON.stringify(err)).not.toContain("s3cret-value")
  })

  it("maps a timeout to 502", async () => {
    const fetchImpl = ((_u: string, init: { signal: AbortSignal }) =>
      new Promise((_r, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")))
      })) as unknown as typeof fetch
    jest.useFakeTimers()
    const p = failure(callSellerHub("GET", "/x", undefined, { fetchImpl, env }))
    await jest.advanceTimersByTimeAsync(15_001)
    const err = await p
    jest.useRealTimers()
    expect(err.status).toBe(502)
    expect(err.message).toBe("Cannot reach seller-hub")
  })

  it("honors opts.timeoutMs instead of the 15 s default", async () => {
    const fetchImpl = ((_u: string, init: { signal: AbortSignal }) =>
      new Promise((_r, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")))
      })) as unknown as typeof fetch
    jest.useFakeTimers()
    let settled = false
    const p = failure(
      callSellerHub("POST", "/x", undefined, { fetchImpl, env, timeoutMs: 120_000 })
    ).finally(() => {
      settled = true
    })
    await jest.advanceTimersByTimeAsync(60_000)
    expect(settled).toBe(false)
    await jest.advanceTimersByTimeAsync(60_001)
    const err = await p
    jest.useRealTimers()
    expect(err.status).toBe(502)
  })

  it("maps seller-hub 401 to 502", async () => {
    const err = await failure(
      callSellerHub("GET", "/x", undefined, { fetchImpl: reply(401, {}), env })
    )
    expect(err.status).toBe(502)
    expect(err.message).toBe("seller-hub rejected the shared secret")
  })

  it("passes other non-2xx statuses and bodies through", async () => {
    const out = await callSellerHub(
      "PUT",
      "/x",
      {},
      { fetchImpl: reply(422, { error: "test_failed", message: "Bad token" }), env }
    )
    expect(out).toEqual({ status: 422, body: { error: "test_failed", message: "Bad token" } })
  })

  it("never logs", async () => {
    const spies = [
      jest.spyOn(console, "log"),
      jest.spyOn(console, "error"),
      jest.spyOn(console, "warn"),
    ]
    await callSellerHub("PUT", "/x", { access_token: "tok" }, { fetchImpl: reply(200, { a: 1 }), env })
    await failure(callSellerHub("GET", "/x", undefined, { fetchImpl: reply(401, {}), env }))
    for (const s of spies) expect(s).not.toHaveBeenCalled()
  })
})
