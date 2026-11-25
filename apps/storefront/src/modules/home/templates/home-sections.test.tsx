// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { HttpTypes } from "@medusajs/types"
import type { ResolvedSection } from "@lib/content/homepage-sections"
import { cleanup, render } from "../../../test/render"

const getHomepageSections = vi.fn()
const listSectionProducts = vi.fn()

vi.mock("@lib/data/homepage", () => ({
  getHomepageSections: (...args: unknown[]) => getHomepageSections(...args),
  listSectionProducts: (...args: unknown[]) => listSectionProducts(...args),
  listBrandTiles: async () => [],
  listShopTiles: async () => [],
}))

vi.mock("@modules/common/components/localized-client-link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string
    children: React.ReactNode
  }) => <a href={href}>{children}</a>,
}))

vi.mock("@modules/products/components/product-preview", () => ({
  ProductCardView: ({ title }: { title: string }) => <span>{title}</span>,
}))

import HomeSections, {
  SectionProducts,
  planHomeSections,
} from "./home-sections"

const region = { id: "reg_1" } as HttpTypes.StoreRegion
const latest: ResolvedSection = {
  id: "new-arrivals",
  title: "New arrivals",
  kind: "latest",
}
const product = { id: "p1", title: "Oud", handle: "oud" } as HttpTypes.StoreProduct

beforeEach(() => {
  getHomepageSections.mockReset()
  listSectionProducts.mockReset()
})
afterEach(cleanup)

describe("HomeSections", () => {
  it("renders nothing and does not throw when the data layer fails", async () => {
    getHomepageSections.mockResolvedValue(null)
    await expect(HomeSections({ countryCode: "us" })).resolves.toBeNull()
  })

  it("plans category, brand, sections, then static blocks in order", () => {
    expect(planHomeSections([latest]).map((s) => s.key)).toEqual([
      "categories",
      "brands",
      "section:new-arrivals",
      "promos",
      "editorial",
      "newsletter",
    ])
  })

  it("returns an element tree for resolved sections", async () => {
    getHomepageSections.mockResolvedValue({ region, sections: [latest] })
    const tree = await HomeSections({ countryCode: "us" })
    expect(tree).not.toBeNull()
  })
})

describe("SectionProducts", () => {
  it("renders a ProductSection with the section title", async () => {
    listSectionProducts.mockResolvedValue([product])
    const el = await SectionProducts({ section: latest, regionId: "reg_1" })
    const { container } = render(<>{el}</>)
    expect(container.querySelector("h2")?.textContent).toBe("New arrivals")
    expect(container.querySelector('a[href="/store"]')).not.toBeNull()
  })

  it("links collection sections to their collection page", async () => {
    listSectionProducts.mockResolvedValue([product])
    const section: ResolvedSection = {
      id: "mens",
      title: "Men's collection",
      kind: "collection",
      collection: { id: "c1", handle: "mens" },
    }
    const el = await SectionProducts({ section, regionId: "reg_1" })
    const { container } = render(<>{el}</>)
    expect(container.querySelector('a[href="/collections/mens"]')).not.toBeNull()
  })

  it("renders nothing when the section has no products", async () => {
    listSectionProducts.mockResolvedValue([])
    const el = await SectionProducts({ section: latest, regionId: "reg_1" })
    const { container } = render(<>{el}</>)
    expect(container.querySelector("section")).toBeNull()
  })
})
