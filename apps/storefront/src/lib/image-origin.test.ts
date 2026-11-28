import { describe, expect, it } from "vitest"
import { buildRemotePatterns, resolveImageOrigin } from "./image-origin"

describe("resolveImageOrigin", () => {
  it("prefers the image origin over the backend url", () => {
    expect(
      resolveImageOrigin({
        NEXT_PUBLIC_IMAGE_ORIGIN: "https://img.example.com",
        NEXT_PUBLIC_MEDUSA_BACKEND_URL: "https://admin.example.com",
      })
    ).toBe("https://img.example.com")
  })

  it("falls back to the backend url", () => {
    expect(
      resolveImageOrigin({
        NEXT_PUBLIC_MEDUSA_BACKEND_URL: "https://admin.example.com",
      })
    ).toBe("https://admin.example.com")
  })

  it("returns the bare origin without path or trailing slash", () => {
    expect(
      resolveImageOrigin({ NEXT_PUBLIC_IMAGE_ORIGIN: " https://img.example.com/x " })
    ).toBe("https://img.example.com")
    expect(
      resolveImageOrigin({ NEXT_PUBLIC_IMAGE_ORIGIN: "http://localhost:9000/" })
    ).toBe("http://localhost:9000")
  })

  it("returns null for invalid or missing values", () => {
    expect(resolveImageOrigin({ NEXT_PUBLIC_IMAGE_ORIGIN: "ftp://x" })).toBeNull()
    expect(resolveImageOrigin({ NEXT_PUBLIC_IMAGE_ORIGIN: "" })).toBeNull()
    expect(resolveImageOrigin({ NEXT_PUBLIC_IMAGE_ORIGIN: "not a url" })).toBeNull()
    expect(resolveImageOrigin({})).toBeNull()
  })
})

describe("buildRemotePatterns", () => {
  it("includes the image origin and the development localhost only", () => {
    const patterns = buildRemotePatterns({
      NEXT_PUBLIC_IMAGE_ORIGIN: "https://img.example.com",
    })
    expect(patterns).toEqual([
      { protocol: "https", hostname: "img.example.com" },
      { protocol: "http", hostname: "localhost" },
    ])
  })

  it("never includes a generic S3 wildcard, in any environment", () => {
    for (const NODE_ENV of ["production", "development", undefined]) {
      for (const origin of [undefined, "https://img.example.com", "http://localhost:9000"]) {
        const patterns = buildRemotePatterns({
          NODE_ENV,
          NEXT_PUBLIC_IMAGE_ORIGIN: origin,
        })
        expect(patterns.some((p) => p.hostname.includes("amazonaws.com"))).toBe(false)
        expect(patterns.some((p) => p.hostname.includes("*"))).toBe(false)
      }
    }
  })

  it("allows an S3 host only when it is the configured origin", () => {
    expect(
      buildRemotePatterns({
        NODE_ENV: "production",
        NEXT_PUBLIC_IMAGE_ORIGIN: "https://bucket.s3.eu-west-1.amazonaws.com",
      })
    ).toEqual([{ protocol: "https", hostname: "bucket.s3.eu-west-1.amazonaws.com" }])
  })

  it("keeps the port of the origin", () => {
    const patterns = buildRemotePatterns({
      NEXT_PUBLIC_IMAGE_ORIGIN: "http://localhost:9000",
    })
    expect(patterns).toContainEqual({
      protocol: "http",
      hostname: "localhost",
      port: "9000",
    })
  })

  it("has no duplicates and no wildcard-all hostname", () => {
    const patterns = buildRemotePatterns({
      NEXT_PUBLIC_IMAGE_ORIGIN: "http://localhost",
    })
    const keys = patterns.map((p) => `${p.protocol}|${p.hostname}|${p.port ?? ""}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(patterns.some((p) => p.hostname === "**")).toBe(false)
  })

  it("works without any origin", () => {
    expect(buildRemotePatterns({})).toEqual([{ protocol: "http", hostname: "localhost" }])
    expect(buildRemotePatterns({ NODE_ENV: "production" })).toEqual([])
  })

  const localhostEntries = (env: Record<string, string | undefined>) =>
    buildRemotePatterns(env).filter(
      (p) => p.hostname === "localhost" || p.hostname === "127.0.0.1"
    )

  it("allows any localhost port outside production", () => {
    expect(buildRemotePatterns({ NODE_ENV: "development" })).toContainEqual({
      protocol: "http",
      hostname: "localhost",
    })
  })

  it("has no localhost pattern in production without a local origin", () => {
    expect(localhostEntries({ NODE_ENV: "production" })).toEqual([])
    expect(
      localhostEntries({
        NODE_ENV: "production",
        NEXT_PUBLIC_IMAGE_ORIGIN: "https://img.example.com",
      })
    ).toEqual([])
  })

  it("pins localhost to the origin port in production", () => {
    expect(
      localhostEntries({
        NODE_ENV: "production",
        NEXT_PUBLIC_MEDUSA_BACKEND_URL: "http://localhost:9000",
      })
    ).toEqual([{ protocol: "http", hostname: "localhost", port: "9000" }])
    expect(
      localhostEntries({
        NODE_ENV: "production",
        NEXT_PUBLIC_IMAGE_ORIGIN: "http://127.0.0.1:9000",
      })
    ).toEqual([{ protocol: "http", hostname: "127.0.0.1", port: "9000" }])
  })

  it("pins a default-port local origin to the default port in production", () => {
    expect(
      localhostEntries({
        NODE_ENV: "production",
        NEXT_PUBLIC_IMAGE_ORIGIN: "http://localhost",
      })
    ).toEqual([{ protocol: "http", hostname: "localhost", port: "" }])
  })
})
