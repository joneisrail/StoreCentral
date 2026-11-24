import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest"
import { Pool } from "pg"
import { assertTestDatabase } from "../test-support/database-guard.js"
import { runMigrations } from "../db/migrate.js"
import {
  AmazonSettingsInputError,
  clearAmazonSettings,
  resolveAmazonSettings,
  saveAmazonSettings,
} from "./amazon-settings.js"

const KEY = "ab".repeat(32)
const REGION = "us-east-1"
const QUEUE = "https://sqs.us-east-1.amazonaws.com/123456789012/orders"
const CLIENT_ID = "amzn1.application-oa2-client.abc123"

describe("amazon settings store", () => {
  let pool: Pool

  beforeAll(async () => {
    pool = new Pool({ connectionString: assertTestDatabase(process.env.TEST_DATABASE_URL) })
    await runMigrations(pool)
  }, 30_000)

  beforeEach(async () => {
    await clearAmazonSettings(pool)
  })

  afterAll(async () => {
    if (pool) await clearAmazonSettings(pool)
    await pool?.end()
  })

  const full = {
    awsRegion: REGION,
    sqsQueueUrl: QUEUE,
    lwaClientId: CLIENT_ID,
    awsAccessKeyId: "AKIAEXAMPLE",
    awsSecretAccessKey: "aws-secret-value",
    lwaClientSecret: "lwa-secret-value",
  }

  test("save then resolve returns database source", async () => {
    await saveAmazonSettings(pool, KEY, full)
    const r = await resolveAmazonSettings(pool, KEY, {})
    expect(r.awsRegion).toEqual({ value: REGION, source: "database" })
    expect(r.sqsQueueUrl).toEqual({ value: QUEUE, source: "database" })
    expect(r.lwaClientId).toEqual({ value: CLIENT_ID, source: "database" })
    expect(r.awsKeys).toEqual({ accessKeyId: "AKIAEXAMPLE", secretAccessKey: "aws-secret-value" })
    expect(r.awsKeysSource).toBe("database")
    expect(r.lwaClientSecret).toEqual({ value: "lwa-secret-value", source: "database" })
  })

  test("stored secret columns are not the plaintext", async () => {
    await saveAmazonSettings(pool, KEY, full)
    const { rows } = await pool.query(`SELECT * FROM seller_hub.amazon_settings`)
    const dump = JSON.stringify(rows)
    for (const secret of ["AKIAEXAMPLE", "aws-secret-value", "lwa-secret-value"]) {
      expect(dump).not.toContain(secret)
    }
    expect(rows[0].lwa_client_secret_encrypted).toBeTruthy()
  })

  test("blank input keeps stored value", async () => {
    await saveAmazonSettings(pool, KEY, full)
    await saveAmazonSettings(pool, KEY, { awsRegion: "eu-west-1", lwaClientSecret: "  ", sqsQueueUrl: "" })
    const r = await resolveAmazonSettings(pool, KEY, {})
    expect(r.awsRegion.value).toBe("eu-west-1")
    expect(r.sqsQueueUrl.value).toBe(QUEUE)
    expect(r.lwaClientSecret.value).toBe("lwa-secret-value")
    expect(r.awsKeys?.secretAccessKey).toBe("aws-secret-value")
  })

  test("environment fallback per field with source environment", async () => {
    await saveAmazonSettings(pool, KEY, { awsRegion: REGION })
    const r = await resolveAmazonSettings(pool, KEY, {
      SQS_QUEUE_URL: QUEUE,
      AMAZON_LWA_CLIENT_SECRET: "env-secret",
      AWS_ACCESS_KEY_ID: "AKIAENV",
      AWS_SECRET_ACCESS_KEY: "env-aws-secret",
    })
    expect(r.awsRegion.source).toBe("database")
    expect(r.sqsQueueUrl).toEqual({ value: QUEUE, source: "environment" })
    expect(r.lwaClientSecret).toEqual({ value: "env-secret", source: "environment" })
    expect(r.lwaClientId).toEqual({ value: null, source: "none" })
    expect(r.awsKeys).toEqual({ accessKeyId: "AKIAENV", secretAccessKey: "env-aws-secret" })
    expect(r.awsKeysSource).toBe("environment")
  })

  test("database wins over environment", async () => {
    await saveAmazonSettings(pool, KEY, full)
    const r = await resolveAmazonSettings(pool, KEY, {
      AWS_REGION: "ap-south-1",
      AWS_ACCESS_KEY_ID: "AKIAENV",
      AWS_SECRET_ACCESS_KEY: "env-aws-secret",
      AMAZON_LWA_CLIENT_SECRET: "env-secret",
    })
    expect(r.awsRegion.value).toBe(REGION)
    expect(r.awsKeys?.accessKeyId).toBe("AKIAEXAMPLE")
    expect(r.lwaClientSecret.value).toBe("lwa-secret-value")
  })

  test("key pair saved together, half pair rejected naming awsAccessKeyId or awsSecretAccessKey", async () => {
    await expect(saveAmazonSettings(pool, KEY, { awsAccessKeyId: "AKIAONLY" })).rejects.toMatchObject({
      fields: ["awsSecretAccessKey"],
      kind: "missing",
    })
    await expect(saveAmazonSettings(pool, KEY, { awsSecretAccessKey: "only-secret" })).rejects.toMatchObject({
      fields: ["awsAccessKeyId"],
    })
    await saveAmazonSettings(pool, KEY, { awsAccessKeyId: "AKIA1", awsSecretAccessKey: "s1" })
    await saveAmazonSettings(pool, KEY, { awsSecretAccessKey: "s2" })
    const r = await resolveAmazonSettings(pool, KEY, {})
    expect(r.awsKeys).toEqual({ accessKeyId: "AKIA1", secretAccessKey: "s2" })
  })

  test("invalid region, queue url and client id rejected naming the field not the value", async () => {
    const bad = {
      awsRegion: "Not A Region",
      sqsQueueUrl: "http://evil.example.com/q",
      lwaClientId: "wrong-prefix-SECRETISH",
    }
    const err = await saveAmazonSettings(pool, KEY, bad).catch((e) => e)
    expect(err).toBeInstanceOf(AmazonSettingsInputError)
    expect(err.kind).toBe("invalid")
    expect(err.fields).toEqual(["awsRegion", "sqsQueueUrl", "lwaClientId"])
    for (const v of Object.values(bad)) expect(err.message).not.toContain(v)
    await expect(
      saveAmazonSettings(pool, KEY, { sqsQueueUrl: "https://sqs.example.com/q" })
    ).rejects.toMatchObject({ fields: ["sqsQueueUrl"] })
    await saveAmazonSettings(pool, KEY, {
      sqsQueueUrl: "https://sqs.cn-north-1.amazonaws.com.cn/1/q",
    })
  })

  test("clear returns fields to environment or none", async () => {
    await saveAmazonSettings(pool, KEY, full)
    await clearAmazonSettings(pool)
    const r = await resolveAmazonSettings(pool, KEY, { AWS_REGION: "eu-west-1" })
    expect(r.awsRegion).toEqual({ value: "eu-west-1", source: "environment" })
    expect(r.sqsQueueUrl).toEqual({ value: null, source: "none" })
    expect(r.awsKeys).toBeNull()
    expect(r.awsKeysSource).toBe("none")
  })

  test("undecryptable secret resolves as none and does not throw", async () => {
    await saveAmazonSettings(pool, KEY, full)
    const otherKey = "cd".repeat(32)
    const r = await resolveAmazonSettings(pool, otherKey, {})
    expect(r.lwaClientSecret).toEqual({ value: null, source: "none" })
    expect(r.awsKeys).toBeNull()
    expect(r.awsRegion.value).toBe(REGION)
  })

  test("queue url host must be exactly amazonaws.com or a subdomain of it", async () => {
    for (const host of ["evilamazonaws.com", "evilamazonaws.com.cn", "amazonaws.com.evil.example"]) {
      await expect(
        saveAmazonSettings(pool, KEY, { sqsQueueUrl: `https://${host}/1/q` })
      ).rejects.toMatchObject({ fields: ["sqsQueueUrl"] })
    }
    await saveAmazonSettings(pool, KEY, { sqsQueueUrl: "https://sqs.us-east-1.amazonaws.com/1/q" })
    await saveAmazonSettings(pool, KEY, { sqsQueueUrl: "https://amazonaws.com/1/q" })
    await saveAmazonSettings(pool, KEY, { sqsQueueUrl: "https://sqs.cn-north-1.amazonaws.com.cn/1/q" })
  })

  test("undecryptable stored secret falls back to the environment value", async () => {
    await saveAmazonSettings(pool, KEY, full)
    const r = await resolveAmazonSettings(pool, "cd".repeat(32), {
      AMAZON_LWA_CLIENT_SECRET: "env-lwa-secret",
      AWS_ACCESS_KEY_ID: "AKIAENV",
      AWS_SECRET_ACCESS_KEY: "env-aws-secret",
    })
    expect(r.lwaClientSecret).toEqual({ value: "env-lwa-secret", source: "environment" })
    expect(r.awsKeys).toEqual({ accessKeyId: "AKIAENV", secretAccessKey: "env-aws-secret" })
    expect(r.awsKeysSource).toBe("environment")
  })

  test("only one row can exist", async () => {
    await saveAmazonSettings(pool, KEY, full)
    await saveAmazonSettings(pool, KEY, { awsRegion: "eu-west-1" })
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM seller_hub.amazon_settings`)
    expect(rows[0].n).toBe(1)
    await expect(
      pool.query(`INSERT INTO seller_hub.amazon_settings (id) VALUES (false)`)
    ).rejects.toThrow()
  })
})
