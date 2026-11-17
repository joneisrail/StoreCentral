import { expect, test, vi } from "vitest"
import { MedusaAdminClient } from "./admin-client.js"

const makeClient = (respond: (url: string, init?: RequestInit) => Response) => {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    if (u.endsWith("/auth/user/emailpass")) {
      return new Response(JSON.stringify({ token: "t" }), { status: 200 })
    }
    calls.push({ url: u, init })
    return respond(u, init)
  })
  const client = new MedusaAdminClient({
    baseUrl: "http://m",
    email: "e",
    password: "p",
    fetchImpl: fetchImpl as unknown as typeof fetch,
  })
  return { client, calls }
}

test("getChannelPushValues reads the channel's push-values route", async () => {
  const { client, calls } = makeClient(
    () => new Response(JSON.stringify({ price: null, effective_price: 9.5, stock: 3 }), { status: 200 })
  )
  const values = await client.getChannelPushValues("variant 1", "sc_1")
  expect(values).toEqual({ price: null, effective_price: 9.5, stock: 3 })
  expect(calls[0]!.url).toBe("http://m/admin/channel-offers/variant%201/sc_1/push-values")
  expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe("Bearer t")
})

test("getChannelPushValues surfaces a non-2xx as an error with the status", async () => {
  const { client } = makeClient(() => new Response("{}", { status: 404 }))
  await expect(client.getChannelPushValues("v", "c")).rejects.toThrow(/status 404/)
})

test("reportChannelSyncResult POSTs the result", async () => {
  const { client, calls } = makeClient(() => new Response("{}", { status: 200 }))
  await client.reportChannelSyncResult("v1", "sc_1", { state: "synced", price: 10, stock: 2 })
  expect(calls[0]!.url).toBe("http://m/admin/channel-offers/v1/sc_1/sync-result")
  expect(calls[0]!.init?.method).toBe("POST")
  expect(JSON.parse(calls[0]!.init?.body as string)).toEqual({ state: "synced", price: 10, stock: 2 })
})

test("reportChannelSyncResult truncates the error to 500 chars and redacts credentials", async () => {
  const { client, calls } = makeClient(() => new Response("{}", { status: 200 }))
  await client.reportChannelSyncResult("v1", "sc_1", {
    state: "failed",
    error: `Bearer abc.def-123 failed access_token=shpat_XYZ ${"x".repeat(900)}`,
  })
  const body = JSON.parse(calls[0]!.init?.body as string)
  expect(body.state).toBe("failed")
  expect(body.error.length).toBeLessThanOrEqual(500)
  expect(body.error).not.toContain("abc.def-123")
  expect(body.error).not.toContain("shpat_XYZ")
})
