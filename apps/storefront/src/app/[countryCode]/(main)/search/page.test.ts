import { beforeEach, describe, expect, it, vi } from "vitest"

const redirect = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`)
})
vi.mock("next/navigation", () => ({
  redirect: (p: string) => redirect(p),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND")
  },
}))
vi.mock("@lib/data/regions", () => ({
  getRegion: async () => ({ currency_code: "usd" }),
}))
vi.mock("@lib/data/search-insights", () => ({
  getPopularSearches: async () => ["Dior"],
}))
vi.mock("@modules/search/templates/search-results", () => ({ default: () => null }))

import SearchPage, { generateMetadata } from "./page"

const call = (q?: string) =>
  SearchPage({
    params: Promise.resolve({ countryCode: "us" }),
    searchParams: Promise.resolve({ q }),
  })

beforeEach(() => {
  redirect.mockClear()
})

describe("SearchPage", () => {
  it.each([undefined, "", "   "])("redirects empty q (%j) to /store", async (q) => {
    await expect(call(q)).rejects.toThrow("NEXT_REDIRECT:/us/store")
    expect(redirect).toHaveBeenCalledWith("/us/store")
  })

  it("passes a trimmed, capped query and popular searches down", async () => {
    const el = (await call(`  ${"a".repeat(300)}  `)) as {
      props: { query: string; popularSearches: string[] }
    }
    expect(el.props.query).toHaveLength(200)
    expect(el.props.popularSearches).toEqual(["Dior"])
  })

  it("keys the results by query so a new q remounts", async () => {
    const a = (await call("rose")) as { key: string }
    const b = (await call("oud")) as { key: string }
    expect(a.key).toBe("rose")
    expect(b.key).toBe("oud")
  })

  it("is noindex,follow with a query title", async () => {
    const meta = await generateMetadata({ searchParams: Promise.resolve({ q: "rose" }) })
    expect(meta.robots).toEqual({ index: false, follow: true })
    expect(String(meta.title)).toContain("Results for “rose”")
  })
})
