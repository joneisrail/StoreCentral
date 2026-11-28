// next.config.js is CommonJS (Next loads it with require).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const checkEnvVariables = require("./check-env-variables")

checkEnvVariables()

/**
 * Medusa Cloud-related environment variables
 */
const S3_HOSTNAME = process.env.MEDUSA_CLOUD_S3_HOSTNAME
const S3_PATHNAME = process.env.MEDUSA_CLOUD_S3_PATHNAME

/**
 * Image hosts the optimiser may fetch from. This file is CommonJS and cannot
 * import src/lib/image-origin.ts, so these few lines mirror buildRemotePatterns
 * there; next.config.test.ts asserts both give the same list.
 */
const parseHttpOrigin = (value) => {
  const trimmed = value && value.trim()
  if (!trimmed) {
    return null
  }
  try {
    const url = new URL(trimmed)
    return url.protocol === "http:" || url.protocol === "https:" ? url : null
  } catch {
    return null
  }
}

const buildRemotePatterns = (env) => {
  const patterns = []
  const origin =
    parseHttpOrigin(env.NEXT_PUBLIC_IMAGE_ORIGIN) ||
    parseHttpOrigin(env.NEXT_PUBLIC_MEDUSA_BACKEND_URL)
  if (origin) {
    patterns.push({
      protocol: origin.protocol === "https:" ? "https" : "http",
      hostname: origin.hostname,
      ...(origin.port ? { port: origin.port } : {}),
    })
  }
  patterns.push(
    { protocol: "http", hostname: "localhost" },
    { protocol: "https", hostname: "*.s3.*.amazonaws.com" },
    { protocol: "https", hostname: "*.s3.amazonaws.com" }
  )
  const seen = new Set()
  return patterns.filter((p) => {
    const key = `${p.protocol}|${p.hostname}|${p.port || ""}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

/**
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
  images: {
    // The loader rewrites stored /static/ URLs onto NEXT_PUBLIC_IMAGE_ORIGIN
    // and emits /_next/image URLs. `loader` stays "default": any other value
    // turns the built-in /_next/image route into a 404.
    loaderFile: "./src/lib/image-loader.ts",
    formats: ["image/avif", "image/webp"],
    // Widths follow the screens in tailwind.config.js, which extend (not
    // replace) Tailwind's sm 640 / md 768 / lg 1024 / xl 1280:
    //   360, 480 -> phones, 2xsmall (320) up to xsmall (512)
    //   640      -> sm
    //   768      -> md, tablets
    //   1024     -> small (1024)
    //   1280     -> medium (1280)
    //   1600     -> large (1440) and xlarge (1680); the catalogue originals
    //               are at most 1800 px wide, so wider sizes add nothing.
    deviceSizes: [360, 480, 640, 768, 1024, 1280, 1600],
    // Slots narrower than a screen: search rows and small thumbnails (64-128),
    // cards in multi-column grids (180-384).
    imageSizes: [64, 96, 128, 180, 256, 384],
    qualities: [60, 75],
    // 31 days. Resized images are keyed by URL, width, quality and format.
    minimumCacheTTL: 2678400,
    remotePatterns: [
      ...buildRemotePatterns(process.env),
      ...(S3_HOSTNAME && S3_PATHNAME
        ? [
            {
              protocol: "https",
              hostname: S3_HOSTNAME,
              pathname: S3_PATHNAME,
            },
          ]
        : []),
    ],
  },
}

module.exports = nextConfig
