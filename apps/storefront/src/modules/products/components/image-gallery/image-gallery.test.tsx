// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render } from "../../../../test/render"
import ImageGallery from "./index"

afterEach(cleanup)

describe("ImageGallery", () => {
  it("uses the product title in alt text", () => {
    const { container } = render(
      <ImageGallery
        title="Khamrah"
        images={[
          { id: "a", url: "https://x.test/a.jpg" },
          { id: "b", url: "https://x.test/b.jpg" },
        ] as never}
      />
    )
    const alts = Array.from(container.querySelectorAll("img")).map((i) =>
      i.getAttribute("alt")
    )
    expect(alts).toEqual(["Khamrah image 1", "Khamrah image 2"])
  })
})
