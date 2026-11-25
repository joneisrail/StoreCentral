// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { HttpTypes } from "@medusajs/types"
import type { ResolvedSection } from "@lib/content/homepage-sections"
import type { ReactElement } from "react"
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
  ProductSections,
  SectionProducts,
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
  const keysOf = (el: unknown) =>
    (el as ReactElement<{ children: ReactElement[] }>).props.children.map(
      (c) => c.key
    )

  it("does not read region or collections itself", async () => {
    const el = await HomeSections({ countryCode: "us" })
    expect(getHomepageSections).not.toHaveBeenCalled()
    expect(keysOf(el)).toEqual([
      "categories",
      "brands",
      "products",
      "promos",
      "editorial",
      "newsletter",
    ])
  })
})

describe("ProductSections", () => {
  it("renders nothing and does not throw when the data layer fails", async () => {
    getHomepageSections.mockResolvedValue(null)
    await expect(ProductSections({ countryCode: "us" })).resolves.toBeNull()
  })

  it("keeps categories, brands, promos, editorial and newsletter when data fails", async () => {
    getHomepageSections.mockResolvedValue(null)
    const el = await HomeSections({ countryCode: "us" })
    const keys = (
      el as ReactElement<{ children: ReactElement[] }>
    ).props.children.map((c) => c.key)
    expect(keys).toEqual(
      expect.arrayContaining([
        "categories",
        "brands",
        "promos",
        "editorial",
        "newsletter",
      ])
    )
    expect(await ProductSections({ countryCode: "us" })).toBeNull()
  })

  it("renders one block per section in order", async () => {
    const bestSellers: ResolvedSection = {
      id: "best-sellers",
      title: "Best sellers",
      kind: "collection",
      collection: { id: "c0", handle: "best-sellers" },
    }
    getHomepageSections.mockResolvedValue({
      region,
      sections: [bestSellers, latest],
    })
    const el = (await ProductSections({
      countryCode: "us",
    })) as ReactElement<{ children: ReactElement[] }>
    expect(el.props.children.map((c) => c.key)).toEqual([
      "section:best-sellers",
      "section:new-arrivals",
    ])
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
