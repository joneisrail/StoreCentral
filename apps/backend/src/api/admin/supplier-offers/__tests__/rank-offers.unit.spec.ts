import { rankOffers } from "../rank-offers"

const offer = (id: string, unit_cost: number | null, is_active = true) => ({
  id,
  unit_cost,
  is_active,
})

const ids = (r: { id: string }[]) => r.map((o) => o.id)

describe("rankOffers", () => {
  it("returns an empty list for no offers", () => {
    expect(rankOffers([])).toEqual([])
  })

  it("marks a single priced active offer as lowest", () => {
    const r = rankOffers([offer("a", 5)])
    expect(r).toEqual([{ ...offer("a", 5), is_lowest: true }])
  })

  it("does not mark a single unpriced offer", () => {
    expect(rankOffers([offer("a", null)])[0].is_lowest).toBe(false)
  })

  it("orders cheapest first with null prices last", () => {
    const r = rankOffers([offer("n", null), offer("b", 9), offer("a", 3)])
    expect(ids(r)).toEqual(["a", "b", "n"])
    expect(r.map((o) => o.is_lowest)).toEqual([true, false, false])
  })

  it("treats zero as a real price", () => {
    const r = rankOffers([offer("a", 2), offer("z", 0)])
    expect(ids(r)).toEqual(["z", "a"])
    expect(r[0].is_lowest).toBe(true)
  })

  it("marks every equally cheapest active offer", () => {
    const r = rankOffers([offer("a", 4), offer("b", 4), offer("c", 6)])
    expect(r.map((o) => o.is_lowest)).toEqual([true, true, false])
  })

  it("keeps input order for ties", () => {
    expect(ids(rankOffers([offer("x", 4), offer("a", 4)]))).toEqual(["x", "a"])
  })

  it("lists inactive offers but never marks them lowest", () => {
    const r = rankOffers([offer("i", 1, false), offer("a", 5), offer("b", 7)])
    expect(ids(r)).toEqual(["i", "a", "b"])
    expect(r.map((o) => o.is_lowest)).toEqual([false, true, false])
  })

  it("marks none when only inactive suppliers have prices", () => {
    const r = rankOffers([offer("i", 1, false), offer("a", null)])
    expect(r.every((o) => !o.is_lowest)).toBe(true)
  })

  it("marks none when all prices are null", () => {
    const r = rankOffers([offer("a", null), offer("b", null)])
    expect(r.every((o) => !o.is_lowest)).toBe(true)
  })
})
