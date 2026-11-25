import type { HttpTypes } from "@medusajs/types"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@lib/data/products", () => ({ listProducts: vi.fn() }))
vi.mock("@lib/data/collections", () => ({ listCollections: vi.fn() }))
vi.mock("@lib/data/categories", () => ({ listCategories: vi.fn() }))
vi.mock("@lib/data/regions", () => ({ getRegion: vi.fn() }))

import { listCategories } from "@lib/data/categories"
import { listCollections } from "@lib/data/collections"
import { listProducts } from "@lib/data/products"
import { getRegion } from "@lib/data/regions"
import {
  getHomepageSections,
  listBrandTiles,
  listSectionProducts,
  listShopTiles,
  pickBrands,
  pickShopCategories,
} from "./homepage"

const cat = (o: Record<string, unknown>) =>
  o as unknown as HttpTypes.StoreProductCategory
const asProducts = (o: unknown) =>
  o as Awaited<ReturnType<typeof listProducts>>
const asRegion = (o: unknown) => o as unknown as HttpTypes.StoreRegion
const asCollections = (o: unknown) =>
  o as Awaited<ReturnType<typeof listCollections>>

describe("pickBrands", () => {
  it("returns [] without a brands category", () => {
    expect(pickBrands([cat({ id: "1", name: "A", handle: "a" })])).toEqual([])
  })

  it("returns children with handles", () => {
    const result = pickBrands([
      cat({
        id: "b",
        name: "Brands",
        handle: "brands",
        category_children: [
          { id: "1", name: "One", handle: "one" },
          { id: "2", name: "Two", handle: "two" },
          { id: "3", name: "NoHandle" },
        ],
      }),
    ])
    expect(result.map((t) => t.handle)).toEqual(["one", "two"])
  })
})

describe("pickShopCategories", () => {
  it("excludes brands, children and handle-less; maps https images only", () => {
    const result = pickShopCategories([
      cat({ id: "b", name: "Brands", handle: "brands" }),
      cat({ id: "c", name: "Child", handle: "child", parent_category_id: "x" }),
      cat({ id: "n", name: "None" }),
      cat({ id: "1", name: "A", handle: "a", metadata: { image_url: "https://x/y.jpg" } }),
      cat({ id: "2", name: "B", handle: "b2", metadata: { image_url: "http://x/y.jpg" } }),
      cat({ id: "3", name: "C", handle: "c3", metadata: { image_url: 5 } }),
    ])
    expect(result).toEqual([
      { id: "1", name: "A", handle: "a", imageUrl: "https://x/y.jpg" },
      { id: "2", name: "B", handle: "b2", imageUrl: null },
      { id: "3", name: "C", handle: "c3", imageUrl: null },
    ])
  })
})

describe("server helpers", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it("listSectionProducts returns [] when listProducts rejects", async () => {
    vi.mocked(listProducts).mockRejectedValue(new Error("x"))
    const r = await listSectionProducts(
      { id: "new-arrivals", title: "New", kind: "latest" },
      "reg"
    )
    expect(r).toEqual([])
  })

  it("listSectionProducts orders latest by -created_at", async () => {
    vi.mocked(listProducts).mockResolvedValue(asProducts({
      response: { products: [{ id: "p" }], count: 1 },
      nextPage: null,
    }))
    const r = await listSectionProducts(
      { id: "new-arrivals", title: "New", kind: "latest" },
      "reg"
    )
    expect(r).toHaveLength(1)
    expect(listProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        regionId: "reg",
        queryParams: expect.objectContaining({
          order: "-created_at",
          limit: 8,
          fields: "*variants.calculated_price",
        }),
      })
    )
  })

  it("listSectionProducts filters by collection_id", async () => {
    vi.mocked(listProducts).mockResolvedValue(asProducts({
      response: { products: [], count: 0 },
      nextPage: null,
    }))
    await listSectionProducts(
      {
        id: "mens",
        title: "M",
        kind: "collection",
        collection: { id: "col1", handle: "mens" },
      },
      "reg",
      4
    )
    expect(listProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        queryParams: expect.objectContaining({
          collection_id: ["col1"],
          limit: 4,
        }),
      })
    )
  })

  it("getHomepageSections returns null without region", async () => {
    vi.mocked(getRegion).mockResolvedValue(null as unknown as HttpTypes.StoreRegion)
    expect(await getHomepageSections("us")).toBeNull()
  })

  it("getHomepageSections returns null when collections reject", async () => {
    vi.mocked(getRegion).mockResolvedValue(asRegion({ id: "r" }))
    vi.mocked(listCollections).mockRejectedValue(new Error("x"))
    expect(await getHomepageSections("us")).toBeNull()
  })

  it("getHomepageSections returns resolved sections", async () => {
    vi.mocked(getRegion).mockResolvedValue(asRegion({ id: "r" }))
    vi.mocked(listCollections).mockResolvedValue(
      asCollections({
        collections: [{ id: "c1", handle: "mens" }],
        count: 1,
      })
    )
    const r = await getHomepageSections("us")
    expect(r?.region.id).toBe("r")
    expect(r?.sections.map((s) => s.id)).toEqual(["new-arrivals", "mens"])
  })

  it("listBrandTiles returns [] when listCategories rejects", async () => {
    vi.mocked(listCategories).mockRejectedValue(new Error("x"))
    expect(await listBrandTiles()).toEqual([])
  })

  it("listBrandTiles requests the category fields once", async () => {
    vi.mocked(listCategories).mockResolvedValue([])
    await listBrandTiles()
    expect(listCategories).toHaveBeenCalledTimes(1)
    expect(listCategories).toHaveBeenCalledWith({
      fields: "id,name,handle,parent_category_id,metadata,*category_children",
      parent_category_id: "null",
      limit: 1000,
    })
  })

  it("listShopTiles queries top-level categories with a large limit", async () => {
    vi.mocked(listCategories).mockResolvedValue([])
    await listShopTiles()
    expect(listCategories).toHaveBeenCalledWith({
      fields: "id,name,handle,parent_category_id,metadata,*category_children",
      parent_category_id: "null",
      limit: 1000,
    })
  })

  it("listBrandTiles caps the strip at 12 brands", async () => {
    vi.mocked(listCategories).mockResolvedValue([
      cat({
        id: "b",
        name: "Brands",
        handle: "brands",
        category_children: Array.from({ length: 30 }, (_, i) => ({
          id: `c${i}`,
          name: `Brand ${i}`,
          handle: `brand-${i}`,
        })),
      }),
    ])
    const tiles = await listBrandTiles()
    expect(tiles).toHaveLength(12)
    expect(tiles[0].handle).toBe("brand-0")
  })

  it("listShopTiles returns [] when listCategories rejects", async () => {
    vi.mocked(listCategories).mockRejectedValue(new Error("x"))
    expect(await listShopTiles()).toEqual([])
  })
})
