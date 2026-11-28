// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render } from "../../../../test/render"

import ImageGallery from "./index"

afterEach(() => {
  cleanup()
  document
    .querySelectorAll('link[rel="preload"][as="image"]')
    .forEach((link) => link.remove())
})

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

  it("gives only the first image priority; the rest are lazy", () => {
    const images = [1, 2, 3, 4].map((n) => ({
      id: `i${n}`,
      url: `/img${n}.jpg`,
    }))
    const { container } = render(
      <ImageGallery images={images as never} title="Oud" />
    )
    const imgs = Array.from(container.querySelectorAll("img"))
    expect(imgs).toHaveLength(4)
    // priority = eager (no loading attr) plus exactly one image preload
    expect(imgs[0].getAttribute("loading")).toBeNull()
    expect(
      document.querySelectorAll('link[rel="preload"][as="image"]')
    ).toHaveLength(1)
    expect(
      document
        .querySelector('link[rel="preload"][as="image"]')
        ?.getAttribute("imagesrcset")
    ).toContain("img1.jpg")
    for (const img of imgs.slice(1)) {
      expect(img.getAttribute("fetchpriority")).toBeNull()
      expect(img.getAttribute("loading")).toBe("lazy")
    }
    expect(imgs[1].getAttribute("alt")).toBe("Oud image 2")
  })
})
