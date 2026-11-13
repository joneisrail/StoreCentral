import { describe, expect, it } from "vitest"
import { resolveInternalSecret } from "./secret.js"

describe("resolveInternalSecret", () => {
  it.each([undefined, "", "   \t "])("treats %j as unset", (raw) => {
    expect(resolveInternalSecret(raw)).toEqual({ secret: null, reason: "unset" })
  })
  it("rejects 15 characters", () => {
    expect(resolveInternalSecret("a".repeat(15))).toEqual({ secret: null, reason: "too_short" })
  })
  it("accepts 16 characters", () => {
    expect(resolveInternalSecret("a".repeat(16))).toEqual({ secret: "a".repeat(16) })
  })
  it("trims padding before measuring and returns the trimmed value", () => {
    expect(resolveInternalSecret("  " + "b".repeat(16) + "\n")).toEqual({ secret: "b".repeat(16) })
    expect(resolveInternalSecret("  " + "b".repeat(15) + "  ").reason).toBe("too_short")
  })
})
