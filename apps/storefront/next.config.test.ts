import { createRequire } from "module"
import { describe, expect, it } from "vitest"

import { buildRemotePatterns } from "./src/lib/image-origin"

// next.config.js is CommonJS and reads the environment when it is loaded, so
// every case loads a fresh copy with its own environment.
const requireCjs = createRequire(import.meta.url)
const CONFIG_PATH = requireCjs.resolve("./next.config.js")

const ENV_KEYS = [
  "NODE_ENV",
  "NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_MEDUSA_BACKEND_URL",
  "NEXT_PUBLIC_IMAGE_ORIGIN",
  "MEDUSA_CLOUD_S3_HOSTNAME",
  "MEDUSA_CLOUD_S3_PATHNAME",
  "IMAGE_ALLOW_LOCAL_ORIGIN",
]

type Env = Record<string, string | undefined>

type ImagesConfig = {
  unoptimized?: boolean
  loader?: string
  loaderFile?: string
  formats?: string[]
  deviceSizes?: number[]
  imageSizes?: number[]
  qualities?: number[]
  minimumCacheTTL?: number
  dangerouslyAllowLocalIP?: boolean
  remotePatterns?: Array<{
    protocol?: string
    hostname: string
    port?: string
    pathname?: string
  }>
}

const loadImagesConfig = (env: Env): ImagesConfig => {
  const saved: Env = {}
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
  // check-env-variables.js exits the process without a publishable key.
  const applied: Env = {
    NODE_ENV: "production",
    NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY: "pk_test",
    NEXT_PUBLIC_MEDUSA_BACKEND_URL: "https://api.example.com",
    ...env,
  }
  for (const [key, value] of Object.entries(applied)) {
    if (value !== undefined) {
      process.env[key] = value
    }
  }
  delete requireCjs.cache[CONFIG_PATH]
  try {
    return requireCjs(CONFIG_PATH).images
  } finally {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = saved[key]
      }
    }
    delete requireCjs.cache[CONFIG_PATH]
  }
}

describe("next.config.js images", () => {
  it("turns the optimiser on with AVIF then WebP and a 31-day cache", () => {
    const images = loadImagesConfig({})
    expect(images.unoptimized).toBeUndefined()
    expect(images.formats).toEqual(["image/avif", "image/webp"])
    expect(images.minimumCacheTTL).toBe(2678400)
  })

  it("uses the custom loader file and keeps the built-in optimiser route", () => {
    const images = loadImagesConfig({})
    expect(images.loaderFile).toBe("./src/lib/image-loader.ts")
    // Any loader other than "default" makes /_next/image answer 404.
    expect(images.loader).toBeUndefined()
  })

  it("limits widths and qualities to short explicit lists", () => {
    const images = loadImagesConfig({})
    expect(images.deviceSizes).toEqual([360, 480, 640, 768, 1024, 1280, 1600])
    expect(images.imageSizes).toEqual([64, 96, 128, 180, 256, 384])
    expect(images.qualities).toEqual([60, 75])
  })

  const localhostEntries = (images: ImagesConfig) =>
    (images.remotePatterns ?? []).filter(
      (p) => p.hostname === "localhost" || p.hostname === "127.0.0.1"
    )

  it("has no localhost pattern in production with a public origin", () => {
    expect(localhostEntries(loadImagesConfig({ NODE_ENV: "production" }))).toEqual([])
    expect(
      localhostEntries(
        loadImagesConfig({
          NODE_ENV: "production",
          NEXT_PUBLIC_IMAGE_ORIGIN: "https://img.example.com",
        })
      )
    ).toEqual([])
  })

  it("pins localhost to the origin port in production", () => {
    const images = loadImagesConfig({
      NODE_ENV: "production",
      NEXT_PUBLIC_IMAGE_ORIGIN: "http://localhost:9000",
    })
    expect(localhostEntries(images)).toEqual([
      { protocol: "http", hostname: "localhost", port: "9000" },
    ])
  })

  it("falls back to the backend url for the localhost port in production", () => {
    const images = loadImagesConfig({
      NODE_ENV: "production",
      NEXT_PUBLIC_MEDUSA_BACKEND_URL: "http://localhost:9000",
    })
    expect(localhostEntries(images)).toEqual([
      { protocol: "http", hostname: "localhost", port: "9000" },
    ])
  })

  it("allows any localhost port in development", () => {
    const images = loadImagesConfig({ NODE_ENV: "development" })
    expect(images.remotePatterns).toContainEqual({
      protocol: "http",
      hostname: "localhost",
    })
    expect(images.dangerouslyAllowLocalIP).toBeUndefined()
  })

  it("allows the image origin host and never a match-all hostname", () => {
    const images = loadImagesConfig({
      NEXT_PUBLIC_IMAGE_ORIGIN: "https://img.example.com",
    })
    expect(images.remotePatterns).toContainEqual({
      protocol: "https",
      hostname: "img.example.com",
    })
    expect(images.remotePatterns?.some((p) => p.hostname === "**")).toBe(false)
  })

  it("keeps the Medusa Cloud S3 pattern when both variables are set", () => {
    const images = loadImagesConfig({
      MEDUSA_CLOUD_S3_HOSTNAME: "bucket.s3.eu-west-1.amazonaws.com",
      MEDUSA_CLOUD_S3_PATHNAME: "/media/**",
    })
    expect(images.remotePatterns).toContainEqual({
      protocol: "https",
      hostname: "bucket.s3.eu-west-1.amazonaws.com",
      pathname: "/media/**",
    })
  })

  const agreementInputs: Env[] = [
    {},
    { NEXT_PUBLIC_IMAGE_ORIGIN: "https://img.example.com" },
    { NEXT_PUBLIC_IMAGE_ORIGIN: " https://img.example.com/x " },
    { NEXT_PUBLIC_IMAGE_ORIGIN: "http://localhost:9000" },
    { NEXT_PUBLIC_IMAGE_ORIGIN: "http://localhost" },
    { NEXT_PUBLIC_IMAGE_ORIGIN: "http://127.0.0.1:9000" },
    { NEXT_PUBLIC_IMAGE_ORIGIN: "ftp://x" },
    { NEXT_PUBLIC_IMAGE_ORIGIN: "not a url" },
    { NEXT_PUBLIC_MEDUSA_BACKEND_URL: "http://localhost:9000" },
    { NEXT_PUBLIC_MEDUSA_BACKEND_URL: "https://admin.example.com:8443/api" },
  ]

  it.each(
    ["production", "development"].flatMap((NODE_ENV) =>
      agreementInputs.map((env) => ({ ...env, NODE_ENV }))
    )
  )("builds the same remote patterns as image-origin.ts for %o", (env) => {
    const images = loadImagesConfig(env)
    const expected = buildRemotePatterns({
      NEXT_PUBLIC_MEDUSA_BACKEND_URL: "https://api.example.com",
      ...env,
    })
    expect(images.remotePatterns).toEqual(expected)
  })

  it("agrees with image-origin.ts in development without a backend url", () => {
    const env = { NEXT_PUBLIC_MEDUSA_BACKEND_URL: undefined, NODE_ENV: "development" }
    expect(loadImagesConfig(env).remotePatterns).toEqual(buildRemotePatterns(env))
  })
})
