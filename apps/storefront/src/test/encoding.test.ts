import { readdirSync, readFileSync, statSync } from "fs"
import { join } from "path"
import { describe, expect, it } from "vitest"

const root = join(__dirname, "..")
const exts = [".ts", ".tsx", ".css", ".js", ".json"]

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })

describe("source encoding", () => {
  it("every source file is valid UTF-8", () => {
    const decoder = new TextDecoder("utf-8", { fatal: true })
    const bad = walk(root)
      .filter((file) => exts.some((ext) => file.endsWith(ext)))
      .filter((file) => {
        try {
          decoder.decode(readFileSync(file))
          return false
        } catch {
          return true
        }
      })
    expect(bad).toEqual([])
  })
})
