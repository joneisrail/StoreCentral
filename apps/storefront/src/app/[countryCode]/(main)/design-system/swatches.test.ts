import { readFileSync } from "fs"
import path from "path"
import { describe, expect, it } from "vitest"
import { contrastRatio, swatches } from "./swatches"

const css = readFileSync(
  path.join(process.cwd(), "src/styles/tokens.css"),
  "utf8"
)

const tokens = Array.from(
  css.matchAll(/--sc-([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)
).map((m) => ({ name: m[1], hex: m[2].toLowerCase() }))

describe("design system swatches", () => {
  it("has a swatch with the same hex for every --sc-* token", () => {
    for (const token of tokens) {
      const swatch = swatches.find((s) => s.name === token.name)
      expect(swatch, `missing swatch for --sc-${token.name}`).toBeDefined()
      expect(swatch?.hex.toLowerCase()).toBe(token.hex)
    }
  })

  it("has no swatch without a token", () => {
    const names = tokens.map((t) => t.name)
    for (const swatch of swatches) {
      expect(names, `no token for swatch ${swatch.name}`).toContain(swatch.name)
    }
  })

  it("covers all eight tokens", () => {
    expect(tokens).toHaveLength(8)
    expect(swatches).toHaveLength(8)
  })

  it("computes contrast ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5)
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5)
  })
})
