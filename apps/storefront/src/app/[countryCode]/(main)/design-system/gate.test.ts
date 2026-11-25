import { describe, expect, it } from "vitest"
import { isPreviewEnabled } from "./gate"

describe("isPreviewEnabled", () => {
  it("is enabled in development", () => {
    expect(isPreviewEnabled({ NODE_ENV: "development" })).toBe(true)
  })

  it("is enabled in test", () => {
    expect(isPreviewEnabled({ NODE_ENV: "test" })).toBe(true)
  })

  it("is disabled in production", () => {
    expect(isPreviewEnabled({ NODE_ENV: "production" })).toBe(false)
  })

  it("is enabled when NODE_ENV is unset", () => {
    expect(isPreviewEnabled({})).toBe(true)
  })
})
