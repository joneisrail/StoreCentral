import {
  createTtlCache,
  loadOrDegrade,
  trendingCacheKey,
} from "../../api/store/search/trending/helpers"

describe("createTtlCache", () => {
  it("reuses the value within the TTL and reloads after it", async () => {
    let t = 1000
    const cache = createTtlCache<string[]>(() => t, 300_000)
    const loader = jest.fn(async () => ["x"])
    await cache.getOrLoad("k", loader)
    t += 299_000
    await cache.getOrLoad("k", loader)
    expect(loader).toHaveBeenCalledTimes(1)
    t += 2_000
    await cache.getOrLoad("k", loader)
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it("does not cache a failed load", async () => {
    const cache = createTtlCache<string[]>(() => 0, 300_000)
    await expect(
      cache.getOrLoad("k", async () => {
        throw new Error("boom")
      })
    ).rejects.toThrow("boom")
    const loader = jest.fn(async () => ["ok"])
    await expect(cache.getOrLoad("k", loader)).resolves.toEqual(["ok"])
  })
})

describe("trendingCacheKey", () => {
  it("is order-independent over channel ids and includes the limit", () => {
    expect(trendingCacheKey(["b", "a"], 5)).toBe(trendingCacheKey(["a", "b"], 5))
    expect(trendingCacheKey(["a"], 5)).not.toBe(trendingCacheKey(["a"], 6))
  })
})

describe("loadOrDegrade", () => {
  it("returns the loaded value as ok", async () => {
    const logger = { error: jest.fn() }
    await expect(
      loadOrDegrade(async () => [1], [] as number[], logger, "[x]")
    ).resolves.toEqual({ value: [1], degraded: false })
    expect(logger.error).not.toHaveBeenCalled()
  })

  it("returns the empty value, degraded, and logs when the loader throws", async () => {
    const logger = { error: jest.fn() }
    const out = await loadOrDegrade(
      async () => {
        throw new Error("boom")
      },
      [] as number[],
      logger,
      "[search-trending]"
    )
    expect(out).toEqual({ value: [], degraded: true })
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error.mock.calls[0][0]).toContain("[search-trending]")
  })
})
