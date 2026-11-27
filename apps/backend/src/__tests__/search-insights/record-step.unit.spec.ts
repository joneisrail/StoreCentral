import { recordSearchQuery } from "../../workflows/steps/record-search-query"

describe("recordSearchQuery step logic", () => {
  it("delegates to the service's atomic upsert, keeping zero results", async () => {
    const service = { recordQuery: jest.fn().mockResolvedValue(undefined) }
    const out = await recordSearchQuery(service as any, { query: "oud", results: 0 })
    expect(service.recordQuery).toHaveBeenCalledWith({ query: "oud", results: 0 })
    expect(out).toEqual({ query: "oud", results: 0 })
  })
})
