import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@lib/config", () => ({ sdk: { client: { fetch: vi.fn() } } }))
vi.mock("./cookies", () => ({ getAuthHeaders: vi.fn() }))
vi.mock("./reviews", () => ({ listReviews: vi.fn() }))

import { sdk } from "@lib/config"
import { getAuthHeaders } from "./cookies"
import { createReview } from "./review-actions"

const input = { productId: "p1", rating: 5, title: "t", comment: "c" }
const fetchMock = sdk.client.fetch as unknown as ReturnType<typeof vi.fn>
const headersMock = getAuthHeaders as unknown as ReturnType<typeof vi.fn>

describe("createReview", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    headersMock.mockResolvedValue({ authorization: "Bearer x" })
  })

  it("asks to sign in without a token", async () => {
    headersMock.mockResolvedValue({})
    expect(await createReview(input)).toEqual({
      ok: false,
      error: "Sign in to write a review",
    })
  })

  it("returns ok on success", async () => {
    fetchMock.mockResolvedValue({})
    expect(await createReview(input)).toEqual({ ok: true })
  })

  it("maps 401 to a sign-in-again text", async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error("Unauthorized"), { status: 401 }))
    expect(await createReview(input)).toEqual({
      ok: false,
      error: "Sign in again to write a review",
    })
  })

  it("maps the verified-purchase rejection by message", async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new Error("You can only review products you've purchased."), {
        status: 400,
      })
    )
    expect(await createReview(input)).toEqual({
      ok: false,
      error: "Only customers who bought this product can review it",
    })
  })

  it("maps a not_allowed type", async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new Error("nope"), { status: 400, type: "not_allowed" })
    )
    expect((await createReview(input)) as { error: string }).toMatchObject({
      error: "Only customers who bought this product can review it",
    })
  })

  it("uses the generic text for anything else and never leaks the message", async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error("db exploded"), { status: 500 }))
    expect(await createReview(input)).toEqual({
      ok: false,
      error: "Couldn't submit your review. Please try again.",
    })
  })
})
