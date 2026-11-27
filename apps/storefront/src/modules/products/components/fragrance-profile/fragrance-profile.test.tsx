// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render } from "../../../../test/render"
import { toFragranceProfile } from "@lib/util/fragrance-profile"
import FragranceProfileSection from "./index"

afterEach(cleanup)

describe("FragranceProfileSection", () => {
  it("renders nothing when the profile is empty", () => {
    const { container } = render(
      <FragranceProfileSection profile={toFragranceProfile({})} />
    )
    expect(container.innerHTML).toBe("")
  })

  it("shows only the present rows and note groups", () => {
    const { container } = render(
      <FragranceProfileSection
        profile={toFragranceProfile({
          metadata: { fragrance_family: "Woody", top_notes: "Bergamot, Pear" },
        })}
      />
    )
    const text = container.textContent ?? ""
    expect(text).toContain("Family")
    expect(text).toContain("Woody")
    expect(text).not.toContain("Gender")
    expect(text).not.toContain("Concentration")
    expect(text).toContain("Top notes")
    expect(text).toContain("Bergamot")
    expect(text).toContain("Pear")
    expect(text).not.toContain("Middle notes")
    expect(text).not.toContain("Base notes")
  })

  it("shows all groups when present", () => {
    const { container } = render(
      <FragranceProfileSection
        profile={toFragranceProfile({
          metadata: {
            gender: "Unisex",
            concentration: "EDP",
            middle_notes: ["Rose"],
            base_notes: ["Oud"],
          },
        })}
      />
    )
    const text = container.textContent ?? ""
    expect(text).toContain("Gender")
    expect(text).toContain("Concentration")
    expect(text).toContain("Middle notes")
    expect(text).toContain("Base notes")
  })
})
