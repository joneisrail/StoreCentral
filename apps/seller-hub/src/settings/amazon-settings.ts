import type { Pool } from "pg"
import { decrypt, encrypt } from "../crypto/secret-box.js"

export type SettingSource = "database" | "environment" | "none"

export type AmazonSettingsInput = {
  awsRegion?: string
  sqsQueueUrl?: string
  lwaClientId?: string
  awsAccessKeyId?: string
  awsSecretAccessKey?: string
  lwaClientSecret?: string
}

export type ResolvedAmazonSettings = {
  awsRegion: { value: string | null; source: SettingSource }
  sqsQueueUrl: { value: string | null; source: SettingSource }
  lwaClientId: { value: string | null; source: SettingSource }
  /** null = use the default AWS credential chain. */
  awsKeys: { accessKeyId: string; secretAccessKey: string } | null
  awsKeysSource: SettingSource
  lwaClientSecret: { value: string | null; source: SettingSource }
}

/** Thrown when input is missing or invalid. Names fields only, never values. */
export class AmazonSettingsInputError extends Error {
  fields: string[]
  kind: "invalid" | "missing"
  constructor(fields: string[], message?: string, kind: "invalid" | "missing" = "invalid") {
    super(message ?? `Missing or invalid fields: ${fields.join(", ")}`)
    this.name = "AmazonSettingsInputError"
    this.fields = fields
    this.kind = kind
  }
}

type Row = {
  aws_region: string | null
  sqs_queue_url: string | null
  lwa_client_id: string | null
  aws_access_key_id_encrypted: string | null
  aws_secret_access_key_encrypted: string | null
  lwa_client_secret_encrypted: string | null
}

const REGION_RE = /^[a-z]{2}(-[a-z]+)+-\d$/
const LWA_CLIENT_ID_PREFIX = "amzn1.application-oa2-client."

const isValidQueueUrl = (value: string): boolean => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return (
    url.protocol === "https:" &&
    (url.hostname.endsWith("amazonaws.com") || url.hostname.endsWith("amazonaws.com.cn"))
  )
}

const readRow = async (pool: Pool): Promise<Row | null> => {
  const { rows } = await pool.query<Row>(
    `SELECT aws_region, sqs_queue_url, lwa_client_id, aws_access_key_id_encrypted,
            aws_secret_access_key_encrypted, lwa_client_secret_encrypted
     FROM seller_hub.amazon_settings WHERE id = true`
  )
  return rows[0] ?? null
}

/** Decrypts one column; a bad ciphertext affects only that field (name logged, never the value). */
const tryDecrypt = (cipher: string | null, key: string, field: string): string | null => {
  if (!cipher) return null
  try {
    return decrypt(cipher, key)
  } catch {
    console.error(`[seller-hub] could not decrypt stored Amazon setting ${field}`)
    return null
  }
}

const plain = (
  stored: string | null | undefined,
  envValue: string | undefined
): { value: string | null; source: SettingSource } => {
  if (stored) return { value: stored, source: "database" }
  if (envValue) return { value: envValue, source: "environment" }
  return { value: null, source: "none" }
}

export const resolveAmazonSettings = async (
  pool: Pool,
  encryptionKey: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<ResolvedAmazonSettings> => {
  const row = await readRow(pool)
  const dbKeyId = tryDecrypt(row?.aws_access_key_id_encrypted ?? null, encryptionKey, "awsAccessKeyId")
  const dbSecret = tryDecrypt(row?.aws_secret_access_key_encrypted ?? null, encryptionKey, "awsSecretAccessKey")
  const lwaSecret = tryDecrypt(row?.lwa_client_secret_encrypted ?? null, encryptionKey, "lwaClientSecret")

  let awsKeys: ResolvedAmazonSettings["awsKeys"] = null
  let awsKeysSource: SettingSource = "none"
  if (dbKeyId && dbSecret) {
    awsKeys = { accessKeyId: dbKeyId, secretAccessKey: dbSecret }
    awsKeysSource = "database"
  } else if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
    awsKeys = { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY }
    awsKeysSource = "environment"
  }

  return {
    awsRegion: plain(row?.aws_region, env.AWS_REGION),
    sqsQueueUrl: plain(row?.sqs_queue_url, env.SQS_QUEUE_URL),
    lwaClientId: plain(row?.lwa_client_id, env.AMAZON_LWA_CLIENT_ID),
    awsKeys,
    awsKeysSource,
    lwaClientSecret: plain(lwaSecret, env.AMAZON_LWA_CLIENT_SECRET),
  }
}

const clean = (v: string | undefined): string => v?.trim() ?? ""

/** Blank input keeps the stored value (NULL stays NULL). */
export const saveAmazonSettings = async (
  pool: Pool,
  encryptionKey: string,
  input: AmazonSettingsInput
): Promise<void> => {
  const region = clean(input.awsRegion)
  const queueUrl = clean(input.sqsQueueUrl)
  const clientId = clean(input.lwaClientId)

  const invalid: string[] = []
  if (region && !REGION_RE.test(region)) invalid.push("awsRegion")
  if (queueUrl && !isValidQueueUrl(queueUrl)) invalid.push("sqsQueueUrl")
  if (clientId && !clientId.startsWith(LWA_CLIENT_ID_PREFIX)) invalid.push("lwaClientId")
  if (invalid.length > 0) throw new AmazonSettingsInputError(invalid, undefined, "invalid")

  const stored = await readRow(pool)
  // Secrets: new value is encrypted; blank keeps the stored ciphertext as-is.
  const secret = (value: string | undefined, current: string | null | undefined): string | null => {
    const v = clean(value)
    return v ? encrypt(v, encryptionKey) : (current ?? null)
  }
  const keyId = secret(input.awsAccessKeyId, stored?.aws_access_key_id_encrypted)
  const secretKey = secret(input.awsSecretAccessKey, stored?.aws_secret_access_key_encrypted)
  const lwaSecret = secret(input.lwaClientSecret, stored?.lwa_client_secret_encrypted)

  if (Boolean(keyId) !== Boolean(secretKey)) {
    throw new AmazonSettingsInputError(
      [keyId ? "awsSecretAccessKey" : "awsAccessKeyId"],
      "The AWS key pair must be saved together",
      "missing"
    )
  }

  await pool.query(
    `INSERT INTO seller_hub.amazon_settings
       (id, aws_region, sqs_queue_url, lwa_client_id, aws_access_key_id_encrypted,
        aws_secret_access_key_encrypted, lwa_client_secret_encrypted, updated_at)
     VALUES (true, $1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (id) DO UPDATE SET
       aws_region = EXCLUDED.aws_region,
       sqs_queue_url = EXCLUDED.sqs_queue_url,
       lwa_client_id = EXCLUDED.lwa_client_id,
       aws_access_key_id_encrypted = EXCLUDED.aws_access_key_id_encrypted,
       aws_secret_access_key_encrypted = EXCLUDED.aws_secret_access_key_encrypted,
       lwa_client_secret_encrypted = EXCLUDED.lwa_client_secret_encrypted,
       updated_at = now()`,
    [
      region || stored?.aws_region || null,
      queueUrl || stored?.sqs_queue_url || null,
      clientId || stored?.lwa_client_id || null,
      keyId,
      secretKey,
      lwaSecret,
    ]
  )
}

/** Removes every stored value; fields fall back to the environment. */
export const clearAmazonSettings = async (pool: Pool): Promise<void> => {
  await pool.query(`DELETE FROM seller_hub.amazon_settings`)
}
