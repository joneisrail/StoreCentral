import { rankPopular } from "../../modules/search-insights/helpers/popular"

const now = new Date("2026-11-27T12:00:00Z")
const days = (n: number) => new Date(now.getTime() - n * 86400000)
const row = (query: string, count: number, o: any = {}) => ({
  query,
  count,
  last_seen_at: days(1),
  results_count: 3,
  ...o,
})

describe("rankPopular", () => {
  it("excludes zero-result, count 1 and stale queries", () => {
    const out = rankPopular(
      [
        row("ok", 2),
        row("none", 5, { results_count: 0 }),
        row("once", 1),
        row("old", 9, { last_seen_at: days(31) }),
      ],
      now
    )
    expect(out).toEqual([{ query: "ok", count: 2 }])
  })

  it("sorts by count desc, ties alphabetical", () => {
    const out = rankPopular([row("b", 3), row("a", 3), row("c", 5)], now)
    expect(out.map((r) => r.query)).toEqual(["c", "a", "b"])
  })

  it("caps at 8", () => {
    const rows = Array.from({ length: 12 }, (_, i) => row(`q${i}`, 2 + i))
    expect(rankPopular(rows, now)).toHaveLength(8)
  })
})
