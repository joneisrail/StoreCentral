import { buildRuntimeModules } from "../runtime-modules"

describe("buildRuntimeModules", () => {
  it("returns no modules when the flag is unset", () => {
    expect(buildRuntimeModules({})).toEqual({ modules: [] })
  })

  it("returns no modules when the flag is false", () => {
    expect(
      buildRuntimeModules({
        BACKEND_REDIS_MODULES: "false",
        REDIS_URL: "redis://x:6379",
      })
    ).toEqual({ modules: [] })
  })

  it("ignores values other than exactly true", () => {
    expect(
      buildRuntimeModules({ BACKEND_REDIS_MODULES: "TRUE", REDIS_URL: "redis://x:6379" })
        .modules
    ).toEqual([])
  })

  it("throws when the flag is on without REDIS_URL", () => {
    expect(() => buildRuntimeModules({ BACKEND_REDIS_MODULES: "true" })).toThrow(
      "BACKEND_REDIS_MODULES=true requires REDIS_URL"
    )
  })

  it("returns the three Redis modules in order with the url", () => {
    const url = "redis://x:6379"
    const result = buildRuntimeModules({
      BACKEND_REDIS_MODULES: "true",
      REDIS_URL: url,
    })

    expect(result.redisUrl).toBe(url)
    expect(result.modules.map((m: any) => m.resolve)).toEqual([
      "@medusajs/medusa/event-bus-redis",
      "@medusajs/medusa/workflow-engine-redis",
      "@medusajs/medusa/locking",
    ])
    const [bus, engine, locking] = result.modules as any[]
    expect(bus.options).toEqual({ redisUrl: url })
    expect(engine.options).toEqual({ redis: { redisUrl: url } })
    expect(locking.options.providers).toEqual([
      {
        resolve: "@medusajs/medusa/locking-redis",
        id: "locking-redis",
        is_default: true,
        options: { redisUrl: url },
      },
    ])
  })
})
