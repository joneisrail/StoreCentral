import { clampLimit, clampOffset, toAverage, toPublicReview } from "../helpers"

const row = (o: Record<string, unknown> = {}) =>
  ({
    id: "rev_1",
    rating: 5,
    title: "Great",
    comment: "Loved it",
    created_at: "2026-11-04T00:00:00.000Z",
    customer: { first_name: "Ana" },
    ...o,
  }) as any

describe("toPublicReview", () => {
  it("uses the trimmed first name", () => {
    expect(toPublicReview(row({ customer: { first_name: "  Ana " } })).author).toBe("Ana")
  })
  it("falls back for a blank first name", () => {
    expect(toPublicReview(row({ customer: { first_name: "   " } })).author).toBe("Customer")
  })
  it("falls back for a null customer", () => {
    expect(toPublicReview(row({ customer: null })).author).toBe("Customer")
  })
  it("exposes only the public keys", () => {
    const out = toPublicReview(
      row({ customer: { first_name: "Ana", email: "a@b.c", id: "cus_1" }, customer_id: "cus_1" })
    )
    expect(Object.keys(out).sort()).toEqual(
      ["author", "comment", "created_at", "id", "rating", "title"].sort()
    )
    expect(JSON.stringify(out)).not.toContain("a@b.c")
    expect(JSON.stringify(out)).not.toContain("cus_1")
  })
  it("converts a Date to an ISO string", () => {
    const d = new Date("2026-11-04T00:00:00.000Z")
    expect(toPublicReview(row({ created_at: d })).created_at).toBe("2026-11-04T00:00:00.000Z")
  })
})

describe("toAverage", () => {
  it("returns null for empty", () => expect(toAverage([])).toBeNull())
  it("averages [5,4]", () => expect(toAverage([5, 4])).toBe(4.5))
  it("rounds [5,5,4] to one decimal", () => expect(toAverage([5, 5, 4])).toBe(4.7))
})

describe("clampLimit", () => {
  it("defaults to 10", () => expect(clampLimit(undefined)).toBe(10))
  it("min 1", () => expect(clampLimit("0")).toBe(1))
  it("max 50", () => expect(clampLimit("999")).toBe(50))
  it("non-numeric defaults", () => expect(clampLimit("abc")).toBe(10))
  it("passes valid", () => expect(clampLimit("7")).toBe(7))
})

describe("clampOffset", () => {
  it("negative to 0", () => expect(clampOffset("-3")).toBe(0))
  it("non-numeric to 0", () => expect(clampOffset("abc")).toBe(0))
  it("passes valid", () => expect(clampOffset("20")).toBe(20))
  it("caps at 10000", () => expect(clampOffset("99999999")).toBe(10000))
})
