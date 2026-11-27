import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@lib/config", () => ({ sdk: { client: { fetch: vi.fn() } } }))

import { sdk } from "@lib/config"
import { trackSearch } from "./track-search"

const fetchMock = sdk.client.fetch as unknown as ReturnType<typeof vi.fn>

describe("trackSearch", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    fetchMock.mockResolvedValue({ ok: true })
  })

  it("posts the trimmed query with keepalive", () => {
    trackSearch("  oud  ", 12)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [path, init] = fetchMock.mock.calls[0]
    expect(path).toBe("/store/search/events")
    expect(init.method).toBe("POST")
    expect(init.keepalive).toBe(true)
    expect(init.body).toEqual({ query: "oud", results: 12 })
  })

  it("skips queries outside 3 to 60 characters", () => {
    trackSearch("ab", 1)
    trackSearch("   ", 1)
    trackSearch("x".repeat(61), 1)
    expect(fetchMock).not.toHaveBeenCalled()
    trackSearch("abc", 1)
    trackSearch("x".repeat(60), 1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("clamps results to an integer >= 0", () => {
    trackSearch("oud", -5)
    trackSearch("oud", 3.9)
    trackSearch("oud", NaN)
    expect(fetchMock.mock.calls.map((c) => c[1].body.results)).toEqual([
      0, 3, 0,
    ])
  })

  it("swallows a rejecting or throwing fetch", async () => {
    fetchMock.mockRejectedValue(new Error("offline"))
    expect(() => trackSearch("oud", 1)).not.toThrow()
    fetchMock.mockImplementation(() => {
      throw new Error("sync")
    })
    expect(() => trackSearch("oud", 1)).not.toThrow()
    await Promise.resolve()
  })
})
