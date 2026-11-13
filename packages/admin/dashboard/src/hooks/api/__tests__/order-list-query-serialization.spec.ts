import { Client } from "@medusajs/js-sdk"
import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(() => vi.unstubAllGlobals())

describe("list query serializer", () => {
  it("emits id[$nin] for an id operator filter", async () => {
    const fetchMock = vi.fn(
      async (..._args: any[]) => new Response("{}", { status: 200 })
    )
    vi.stubGlobal("fetch", fetchMock)

    const client = new Client({ baseUrl: "http://localhost:9000" } as any)
    await client.fetch("/admin/orders", {
      query: { id: { $nin: ["a", "b"] }, limit: 1, fields: "id" },
    })

    const url = decodeURIComponent(String(fetchMock.mock.calls[0][0]))
    expect(url).toContain("id[$nin][0]=a&id[$nin][1]=b")
  })
})
