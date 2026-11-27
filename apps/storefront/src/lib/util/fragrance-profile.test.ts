import { describe, expect, it } from "vitest"
import { toBrandName, toFragranceProfile, toNoteList } from "./fragrance-profile"

describe("toNoteList", () => {
  it("splits a comma separated string and de-duplicates", () => {
    expect(toNoteList("rose, oud, rose")).toEqual(["rose", "oud"])
  })

  it("keeps the first spelling when de-duplicating case-insensitively", () => {
    expect(toNoteList(["Rose", "ROSE", "  oud  "])).toEqual(["Rose", "oud"])
  })

  it("drops non-strings from arrays", () => {
    expect(toNoteList(["rose", 4, null, "musk"])).toEqual(["rose", "musk"])
  })

  it("collapses inner whitespace", () => {
    expect(toNoteList("black   pepper")).toEqual(["black pepper"])
  })

  it("returns an empty list for blanks and unsupported input", () => {
    expect(toNoteList("")).toEqual([])
    expect(toNoteList(" , ")).toEqual([])
    expect(toNoteList(undefined)).toEqual([])
    expect(toNoteList(12)).toEqual([])
  })

  it("caps at 30 values", () => {
    const many = Array.from({ length: 40 }, (_, i) => `note${i}`)
    expect(toNoteList(many)).toHaveLength(30)
  })
})

describe("toBrandName", () => {
  it("returns the category whose parent handle is brands", () => {
    expect(
      toBrandName({
        categories: [
          { name: "Men", parent_category: null },
          { name: "Lattafa", parent_category: { handle: "brands" } },
        ],
      }),
    ).toBe("Lattafa")
  })

  it("returns null when there is no brand", () => {
    expect(toBrandName({ categories: [{ name: "Men" }] })).toBeNull()
    expect(toBrandName({ categories: null })).toBeNull()
    expect(toBrandName({})).toBeNull()
  })
})

describe("toFragranceProfile", () => {
  it("is empty for {} and null metadata", () => {
    expect(toFragranceProfile({ metadata: {} }).isEmpty).toBe(true)
    expect(toFragranceProfile({ metadata: null }).isEmpty).toBe(true)
    expect(toFragranceProfile({}).isEmpty).toBe(true)
  })

  it("reads fields and trims, blank becomes null", () => {
    const profile = toFragranceProfile({
      metadata: {
        fragrance_family: " Oriental ",
        gender: "  ",
        concentration: "EDP",
        top_notes: "bergamot, lemon",
        middle_notes: ["rose"],
        base_notes: "oud",
      },
    })
    expect(profile).toEqual({
      family: "Oriental",
      gender: null,
      concentration: "EDP",
      top: ["bergamot", "lemon"],
      middle: ["rose"],
      base: ["oud"],
      isEmpty: false,
    })
  })
})

describe("toFragranceProfile single-value keys", () => {
  const read = (value: unknown) =>
    toFragranceProfile({ metadata: { gender: value } }).gender

  it("reads a string", () => expect(read(" Women ")).toBe("Women"))
  it("joins an array", () => expect(read(["Men", "Women"])).toBe("Men, Women"))
  it("normalises a comma string", () =>
    expect(read("Men,  Women")).toBe("Men, Women"))
  it("returns null for blanks and unsupported values", () => {
    expect(read("  ")).toBeNull()
    expect(read([])).toBeNull()
    expect(read(5)).toBeNull()
  })

  it("applies to family and concentration and counts toward isEmpty", () => {
    const profile = toFragranceProfile({
      metadata: { fragrance_family: ["Woody", "Spicy"], concentration: ["EDP"] },
    })
    expect(profile.family).toBe("Woody, Spicy")
    expect(profile.concentration).toBe("EDP")
    expect(profile.isEmpty).toBe(false)
  })
})
