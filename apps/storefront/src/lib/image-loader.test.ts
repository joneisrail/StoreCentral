import { describe, expect, it } from "vitest"
import imageLoader, { rewriteImageSrc } from "./image-loader"

describe("rewriteImageSrc", () => {
  const origin = "https://admin.example.com"

  it("re-hosts /static/ urls onto the origin", () => {
    expect(
      rewriteImageSrc("http://localhost:9000/static/perfume-center/a.jpg", origin)
    ).toBe("https://admin.example.com/static/perfume-center/a.jpg")
  })

  it("keeps query and hash", () => {
    expect(
      rewriteImageSrc("http://localhost:9000/static/a.jpg?v=2#x", origin)
    ).toBe("https://admin.example.com/static/a.jpg?v=2#x")
  })

  it("leaves other paths and a null origin alone", () => {
    expect(rewriteImageSrc("https://other.com/img/a.jpg", origin)).toBe(
      "https://other.com/img/a.jpg"
    )
    expect(rewriteImageSrc("http://localhost:9000/static/a.jpg", null)).toBe(
      "http://localhost:9000/static/a.jpg"
    )
  })

  it("leaves non-absolute urls unchanged", () => {
    for (const s of ["/relative.jpg", "//cdn.x/a.jpg", "data:image/png;base64,AAAA", "blob:x", ""]) {
      expect(rewriteImageSrc(s, origin)).toBe(s)
    }
  })

  it("encodes spaces and non-ASCII exactly once", () => {
    expect(
      rewriteImageSrc("http://localhost:9000/static/my file.jpg", origin)
    ).toBe("https://admin.example.com/static/my%20file.jpg")
    expect(
      rewriteImageSrc("http://localhost:9000/static/caf%C3%A9 é.jpg", origin)
    ).toBe("https://admin.example.com/static/caf%C3%A9%20%C3%A9.jpg")
  })
})

describe("imageLoader", () => {
  it("builds the optimizer url", () => {
    expect(imageLoader({ src: "/a.jpg", width: 640, quality: 80 })).toBe(
      "/_next/image?url=%2Fa.jpg&w=640&q=80"
    )
  })

  it("clamps and rounds width", () => {
    expect(imageLoader({ src: "/a.jpg", width: 0 })).toContain("&w=16&")
    expect(imageLoader({ src: "/a.jpg", width: 99999 })).toContain("&w=3840&")
    expect(imageLoader({ src: "/a.jpg", width: 280.7 })).toContain("&w=281&")
  })

  it("defaults, clamps and rounds quality", () => {
    expect(imageLoader({ src: "/a.jpg", width: 64 })).toMatch(/&q=75$/)
    expect(imageLoader({ src: "/a.jpg", width: 64, quality: 0 })).toMatch(/&q=1$/)
    expect(imageLoader({ src: "/a.jpg", width: 64, quality: 500 })).toMatch(/&q=100$/)
    expect(imageLoader({ src: "/a.jpg", width: 64, quality: 60.4 })).toMatch(/&q=60$/)
  })

  it("wraps absolute http urls", () => {
    expect(
      imageLoader({ src: "https://img.example.com/x.jpg", width: 64 }).startsWith(
        "/_next/image?url=https%3A%2F%2Fimg.example.com%2Fx.jpg"
      )
    ).toBe(true)
  })

  it("returns unwrappable srcs unchanged", () => {
    for (const s of ["data:image/png;base64,AAAA", "blob:x", "//cdn.x/a.jpg", "relative.jpg", ""]) {
      expect(imageLoader({ src: s, width: 64 })).toBe(s)
    }
  })
})
