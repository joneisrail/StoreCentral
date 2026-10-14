import { expect, test, vi } from "vitest"
import { refreshAccessToken } from "./auth.js"

test("refreshAccessToken posts grant_type=refresh_token and returns the access token", async () => {
  const fakeFetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ access_token: "atza-fake", expires_in: 3600 }),
  })

  const result = await refreshAccessToken(
    {
      refreshToken: "Atzr|fake",
      clientId: "amzn1.application-oa2-client.fake",
      clientSecret: "fake",
    },
    fakeFetch as unknown as typeof fetch
  )

  expect(result.accessToken).toBe("atza-fake")
  expect(fakeFetch).toHaveBeenCalledWith(
    "https://api.amazon.com/auth/o2/token",
    expect.objectContaining({ method: "POST" })
  )
})

test("refreshAccessToken sends a form-encoded body with the refresh token grant", async () => {
  const fakeFetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ access_token: "atza-fake", expires_in: 3600 }),
  })

  await refreshAccessToken(
    { refreshToken: "Atzr|fake", clientId: "client-id", clientSecret: "client-secret" },
    fakeFetch as unknown as typeof fetch
  )

  const [, init] = fakeFetch.mock.calls[0] as [string, RequestInit]
  expect(init.headers).toMatchObject({
    "Content-Type": "application/x-www-form-urlencoded",
  })
  const params = new URLSearchParams(init.body as string)
  expect(params.get("grant_type")).toBe("refresh_token")
  expect(params.get("refresh_token")).toBe("Atzr|fake")
  expect(params.get("client_id")).toBe("client-id")
  expect(params.get("client_secret")).toBe("client-secret")
})

test("refreshAccessToken computes expiresAt from expires_in", async () => {
  const now = Date.now()
  vi.spyOn(Date, "now").mockReturnValue(now)

  const fakeFetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ access_token: "atza-fake", expires_in: 3600 }),
  })

  const result = await refreshAccessToken(
    { refreshToken: "r", clientId: "c", clientSecret: "s" },
    fakeFetch as unknown as typeof fetch
  )

  expect(result.expiresAt).toBe(now + 3600 * 1000)
  vi.restoreAllMocks()
})

test("refreshAccessToken throws with status and body on a non-ok response", async () => {
  const fakeFetch = vi.fn().mockResolvedValue({
    ok: false,
    status: 401,
    json: async () => ({ error: "invalid_grant" }),
  })

  await expect(
    refreshAccessToken(
      { refreshToken: "bad", clientId: "c", clientSecret: "s" },
      fakeFetch as unknown as typeof fetch
    )
  ).rejects.toThrow(/401/)
})
