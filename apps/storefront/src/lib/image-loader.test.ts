import { afterEach, describe, expect, it, vi } from "vitest"
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

describe("rewriteImageSrc host restriction", () => {
  const origin = "https://admin.example.com"

  it("leaves unknown hosts with a /static/ path unchanged", () => {
    expect(rewriteImageSrc("https://evil.example/static/a.jpg", origin)).toBe(
      "https://evil.example/static/a.jpg"
    )
    expect(
      rewriteImageSrc("https://bucket.s3.amazonaws.com/static/a.jpg", origin)
    ).toBe("https://bucket.s3.amazonaws.com/static/a.jpg")
  })

  it("re-hosts localhost, loopback, origin host and known hosts", () => {
    const want = "https://admin.example.com/static/a.jpg"
    expect(rewriteImageSrc("http://localhost:9000/static/a.jpg", origin)).toBe(want)
    expect(rewriteImageSrc("http://127.0.0.1:9000/static/a.jpg", origin)).toBe(want)
    expect(rewriteImageSrc("http://[::1]:9000/static/a.jpg", origin)).toBe(want)
    expect(rewriteImageSrc("http://admin.example.com/static/a.jpg", origin)).toBe(want)
    expect(
      rewriteImageSrc("https://api.shop.com/static/a.jpg", origin, ["api.shop.com"])
    ).toBe(want)
  })

  it("drops credentials", () => {
    expect(
      rewriteImageSrc("http://u:p@localhost:9000/static/a.jpg", origin)
    ).toBe("https://admin.example.com/static/a.jpg")
  })
})

describe("imageLoader", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("never emits NaN sizes", () => {
    const w = (width: unknown) =>
      imageLoader({ src: "/a.jpg", width: width as number })
    expect(w(NaN)).toContain("&w=16&")
    expect(w("abc")).toContain("&w=16&")
    expect(w(Infinity)).toContain("&w=16&")
    expect(w(-Infinity)).toContain("&w=16&")
    expect(w("384")).toContain("&w=384&")
    const q = (quality: unknown) =>
      imageLoader({ src: "/a.jpg", width: 64, quality: quality as number })
    expect(q(NaN)).toMatch(/&q=75$/)
    expect(q("abc")).toMatch(/&q=75$/)
    expect(q(Infinity)).toMatch(/&q=75$/)
    expect(q(-Infinity)).toMatch(/&q=75$/)
    expect(q("60")).toMatch(/&q=60$/)
  })

  it("does not treat slash-backslash or backslashes as root-relative", () => {
    for (const s of ["/\\evil.com", "\\\\evil.com"]) {
      expect(imageLoader({ src: s, width: 64 })).toBe(s)
    }
  })

  it("re-hosts using the image origin env", () => {
    vi.stubEnv("NEXT_PUBLIC_IMAGE_ORIGIN", "https://img.example.com")
    const out = imageLoader({
      src: "http://localhost:9000/static/a b.jpg",
      width: 640,
      quality: 80,
    })
    expect(out.startsWith("/_next/image?url=")).toBe(true)
    const params = new URLSearchParams(out.split("?")[1])
    expect(params.get("url")).toBe("https://img.example.com/static/a%20b.jpg")
    expect(params.get("w")).toBe("640")
    expect(params.get("q")).toBe("80")
  })

  it("wraps the src unchanged without any origin env", () => {
    vi.stubEnv("NEXT_PUBLIC_IMAGE_ORIGIN", "")
    vi.stubEnv("NEXT_PUBLIC_MEDUSA_BACKEND_URL", "")
    expect(
      imageLoader({ src: "http://localhost:9000/static/a.jpg", width: 64 })
    ).toBe("/_next/image?url=http%3A%2F%2Flocalhost%3A9000%2Fstatic%2Fa.jpg&w=64&q=75")
  })

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
