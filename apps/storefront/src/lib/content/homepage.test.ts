import { describe, expect, it } from "vitest"
import { getNewsletterAction, homepageContent } from "./homepage"
import { PRODUCT_SECTIONS, resolveProductSections } from "./homepage-sections"

describe("resolveProductSections", () => {
  it("keeps only new-arrivals when there are no collections", () => {
    expect(resolveProductSections(PRODUCT_SECTIONS, []).map((s) => s.id)).toEqual(
      ["new-arrivals"]
    )
  })

  it("keeps page order and attaches collection ids", () => {
    const result = resolveProductSections(PRODUCT_SECTIONS, [
      { id: "col_niche", handle: "niche" },
      { id: "col_best", handle: "best-sellers" },
      { id: "col_other", handle: "other" },
    ])
    expect(result.map((s) => s.id)).toEqual([
      "best-sellers",
      "new-arrivals",
      "niche",
    ])
    expect(result[0]).toMatchObject({ collection: { id: "col_best" } })
    expect(result[2]).toMatchObject({ collection: { id: "col_niche" } })
  })

  it("has unique ids and the expected collection handles", () => {
    const ids = PRODUCT_SECTIONS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    const handles = PRODUCT_SECTIONS.flatMap((s) =>
      s.kind === "collection" ? [s.collectionHandle] : []
    )
    expect(handles).toEqual([
      "best-sellers",
      "trending",
      "mens",
      "womens",
      "unisex",
      "arabic",
      "niche",
    ])
  })
})

describe("getNewsletterAction", () => {
  const key = "NEXT_PUBLIC_NEWSLETTER_ACTION_URL"
  it.each([
    [undefined],
    [""],
    ["   "],
    ["http://x.test/f"],
    ["not a url"],
    ["javascript:alert(1)"],
  ])("returns null for %s", (value) => {
    expect(getNewsletterAction({ [key]: value })).toBeNull()
  })

  it("returns the trimmed https url", () => {
    expect(getNewsletterAction({ [key]: " https://x.test/f " })).toBe(
      "https://x.test/f"
    )
  })
})

describe("homepageContent defaults", () => {
  it("has the default hero and no promos", () => {
    expect(homepageContent.hero.headline).toBe("Discover your signature scent")
    expect(homepageContent.announcement).toBeNull()
  })
})
