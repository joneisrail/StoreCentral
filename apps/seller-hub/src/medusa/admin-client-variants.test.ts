import { expect, test, vi } from "vitest"
import { MedusaAdminClient } from "./admin-client.js"

const json = (status: number, body: unknown) =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response

test("listVariantsBySku paginates /admin/product-variants and skips blank SKUs", async () => {
  const urls: string[] = []
  const fetchImpl = vi.fn(async (url: string) => {
    urls.push(url)
    if (url.endsWith("/auth/user/emailpass")) return json(200, { token: "t" })
    const offset = Number(new URL(url).searchParams.get("offset"))
    if (offset === 0) {
      return json(200, {
        count: 3,
        variants: [
          { id: "v1", product_id: "p1", sku: "A" },
          { id: "v2", product_id: "p1", sku: null },
        ],
      })
    }
    return json(200, { count: 3, variants: [{ id: "v3", product_id: "p2", sku: "B" }] })
  })
  const client = new MedusaAdminClient({
    baseUrl: "http://m",
    email: "e",
    password: "p",
    fetchImpl: fetchImpl as unknown as typeof fetch,
  })
  expect(await client.listVariantsBySku()).toEqual([
    { variantId: "v1", productId: "p1", sku: "A" },
    { variantId: "v3", productId: "p2", sku: "B" },
  ])
  const pages = urls.filter((u) => u.includes("/admin/product-variants"))
  expect(pages).toHaveLength(2)
  expect(pages[0]).toContain("fields=id,product_id,sku")
})
