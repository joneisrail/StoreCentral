import { createRequire } from "node:module"
import { describe, expect, it } from "vitest"

const config = createRequire(import.meta.url)("../../../tailwind.config.js")
const generics = ["serif", "sans-serif", "monospace"]

describe("tailwind font families", () => {
  for (const [name, variable] of [
    ["serif", "var(--font-serif)"],
    ["sans", "var(--font-sans)"],
  ] as const) {
    it(`${name} starts with its CSS variable and ends with a generic family`, () => {
      const stack: string[] = config.theme.extend.fontFamily[name]
      expect(stack[0]).toBe(variable)
      expect(generics).toContain(stack[stack.length - 1])
    })
  }
})
