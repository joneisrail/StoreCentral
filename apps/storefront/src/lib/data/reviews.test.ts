import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@lib/config", () => ({ sdk: { client: { fetch: vi.fn() } } }))

import { sdk } from "@lib/config"
import { listReviews } from "./reviews"

const fetchMock = sdk.client.fetch as unknown as ReturnType<typeof vi.fn>

describe("listReviews", () => {
  beforeEach(() => vi.resetAllMocks())

  it("passes a timeout signal to the fetch", async () => {
    fetchMock.mockResolvedValue({ reviews: [], count: 0, average: null })
    await listReviews("p1")
    const init = fetchMock.mock.calls[0][1]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it("returns null when the fetch is aborted or fails", async () => {
    fetchMock.mockRejectedValue(new DOMException("timed out", "TimeoutError"))
    expect(await listReviews("p1")).toBeNull()
  })

  it("maps a page", async () => {
    fetchMock.mockResolvedValue({ reviews: [{ id: "1" }], count: 3, average: 4.5 })
    expect(await listReviews("p1")).toEqual({
      reviews: [{ id: "1" }],
      count: 3,
      average: 4.5,
    })
  })
})
