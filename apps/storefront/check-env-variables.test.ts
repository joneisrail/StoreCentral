import { describe, expect, it } from "vitest"

import { findEnvProblems } from "./check-env-variables"

const base = {
  NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY: "pk_test",
  NEXT_PUBLIC_MEDUSA_BACKEND_URL: "https://api.example.com",
}

describe("findEnvProblems", () => {
  it("passes with the publishable key and backend URL set", () => {
    const result = findEnvProblems({ ...base, NODE_ENV: "production" })
    expect(result.missing).toEqual([])
    expect(result.exposedSecrets).toEqual([])
  })

  it("requires the publishable key in every environment", () => {
    const result = findEnvProblems({ NODE_ENV: "development" })
    expect(result.missing.map((m: { key: string }) => m.key)).toEqual([
      "NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY",
    ])
  })

  it("requires the backend URL only in production", () => {
    const withoutUrl = {
      NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY: "pk_test",
    }
    expect(findEnvProblems({ ...withoutUrl, NODE_ENV: "development" }).missing).toEqual([])
    expect(
      findEnvProblems({ ...withoutUrl, NODE_ENV: "production" }).missing.map(
        (m: { key: string }) => m.key
      )
    ).toEqual(["NEXT_PUBLIC_MEDUSA_BACKEND_URL"])
  })

  it("flags NEXT_PUBLIC_ variables whose names read as secrets", () => {
    const result = findEnvProblems({
      ...base,
      NEXT_PUBLIC_STRIPE_SECRET_KEY: "sk_live_x",
      NEXT_PUBLIC_DB_PASSWORD: "x",
    })
    expect(result.exposedSecrets.sort()).toEqual([
      "NEXT_PUBLIC_DB_PASSWORD",
      "NEXT_PUBLIC_STRIPE_SECRET_KEY",
    ])
  })

  it("allows the publishable keys that are meant for the browser", () => {
    const result = findEnvProblems({
      ...base,
      NEXT_PUBLIC_STRIPE_KEY: "pk_test_x",
      NEXT_PUBLIC_BASE_URL: "https://shop.example.com",
    })
    expect(result.exposedSecrets).toEqual([])
  })

  it("ignores secret-looking names without the NEXT_PUBLIC_ prefix", () => {
    const result = findEnvProblems({ ...base, STRIPE_SECRET_KEY: "sk_live_x" })
    expect(result.exposedSecrets).toEqual([])
  })
})
