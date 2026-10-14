import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { loadEnv } from "./env.js"

const REQUIRED_VARS: Record<string, string> = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/seller_hub",
  REDIS_URL: "redis://localhost:6379",
  MEDUSA_BACKEND_URL: "http://localhost:9000",
  MEDUSA_ADMIN_EMAIL: "admin@example.com",
  MEDUSA_ADMIN_PASSWORD: "secret",
  ENCRYPTION_KEY: "a".repeat(64),
  AWS_REGION: "us-east-1",
  SQS_QUEUE_URL: "https://sqs.us-east-1.amazonaws.com/123456789012/seller-hub",
  AMAZON_LWA_CLIENT_ID: "amzn1.application-oa2-client.test",
  AMAZON_LWA_CLIENT_SECRET: "lwa-secret",
}

describe("loadEnv", () => {
  let prevEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    prevEnv = { ...process.env }
  })

  afterEach(() => {
    process.env = prevEnv
  })

  test("throws when a required variable is missing", () => {
    for (const [key, value] of Object.entries(REQUIRED_VARS)) {
      process.env[key] = value
    }
    delete process.env.DATABASE_URL
    expect(() => loadEnv()).toThrow(/DATABASE_URL/)
  })

  test("returns all fields when env is fully set", () => {
    for (const [key, value] of Object.entries(REQUIRED_VARS)) {
      process.env[key] = value
    }
    const env = loadEnv()
    expect(env).toEqual({
      databaseUrl: REQUIRED_VARS.DATABASE_URL,
      redisUrl: REQUIRED_VARS.REDIS_URL,
      medusaBackendUrl: REQUIRED_VARS.MEDUSA_BACKEND_URL,
      medusaAdminEmail: REQUIRED_VARS.MEDUSA_ADMIN_EMAIL,
      medusaAdminPassword: REQUIRED_VARS.MEDUSA_ADMIN_PASSWORD,
      encryptionKey: REQUIRED_VARS.ENCRYPTION_KEY,
      awsRegion: REQUIRED_VARS.AWS_REGION,
      sqsQueueUrl: REQUIRED_VARS.SQS_QUEUE_URL,
      amazonLwaClientId: REQUIRED_VARS.AMAZON_LWA_CLIENT_ID,
      amazonLwaClientSecret: REQUIRED_VARS.AMAZON_LWA_CLIENT_SECRET,
    })
  })
})
