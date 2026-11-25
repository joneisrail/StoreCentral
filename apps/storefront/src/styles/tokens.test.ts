import { readFileSync } from "fs"
import path from "path"
import { describe, expect, it } from "vitest"

const css = readFileSync(path.join(__dirname, "tokens.css"), "utf8")

const hex = (name: string): string => {
  const match = css.match(new RegExp(String.raw`--sc-${name}:\s*(#[0-9a-fA-F]{6})\s*;`))
  if (!match) {
    throw new Error(`--sc-${name} is not defined as a hex value`)
  }
  return match[1]
}

const channel = (value: number): number => {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

const luminance = (color: string): number => {
  const n = parseInt(color.slice(1), 16)
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  )
}

const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe("brand palette", () => {
  it("uses the exact palette values", () => {
    expect(hex("ivory").toUpperCase()).toBe("#FAF7F2")
    expect(hex("paper").toUpperCase()).toBe("#FFFFFF")
    expect(hex("charcoal").toUpperCase()).toBe("#1E1D1B")
    expect(hex("warm-grey").toUpperCase()).toBe("#6F685E")
    expect(hex("line").toUpperCase()).toBe("#E6DFD3")
    expect(hex("line-strong").toUpperCase()).toBe("#978E80")
    expect(hex("gold").toUpperCase()).toBe("#C2A361")
    expect(hex("gold-deep").toUpperCase()).toBe("#80651F")
  })

  const text: Array<[string, string]> = [
    ["charcoal", "ivory"],
    ["charcoal", "paper"],
    ["warm-grey", "ivory"],
    ["warm-grey", "paper"],
    ["gold-deep", "ivory"],
    ["gold-deep", "paper"],
    ["ivory", "charcoal"],
    ["charcoal", "gold"],
  ]

  it.each(text)("%s on %s meets 4.5:1", (fg, bg) => {
    expect(contrast(hex(fg), hex(bg))).toBeGreaterThanOrEqual(4.5)
  })

  it.each([["paper"], ["ivory"]])("line-strong on %s meets 3:1", (bg) => {
    expect(contrast(hex("line-strong"), hex(bg))).toBeGreaterThanOrEqual(3)
  })
})

describe("ui-preset overrides", () => {
  const vars = [
    "bg-base",
    "bg-base-hover",
    "bg-base-pressed",
    "bg-subtle",
    "bg-subtle-hover",
    "bg-subtle-pressed",
    "bg-field",
    "bg-field-hover",
    "fg-base",
    "fg-subtle",
    "fg-muted",
    "border-base",
    "border-strong",
    "button-inverted",
    "button-inverted-hover",
    "button-inverted-pressed",
    "fg-interactive",
    "fg-interactive-hover",
  ]

  it.each(vars)("defines --%s", (name) => {
    expect(css).toMatch(new RegExp(String.raw`--${name}:\s*var\(--sc-[a-z-]+\)\s*;`))
  })
})
