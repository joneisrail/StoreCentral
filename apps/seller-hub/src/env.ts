export type SellerHubEnv = {
  databaseUrl: string
  redisUrl: string
  medusaBackendUrl: string
  medusaAdminEmail: string
  medusaAdminPassword: string
  encryptionKey: string // 32-byte hex string, used by the crypto helper
  // Amazon settings may instead be stored from the admin UI (settings/amazon-settings.ts).
  awsRegion: string | undefined
  sqsQueueUrl: string | undefined
  amazonLwaClientId: string | undefined
  amazonLwaClientSecret: string | undefined
}

const optionalVar = (name: string): string | undefined => process.env[name] || undefined

const requiredVar = (name: string): string => {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

/**
 * Reads seller-hub configuration from process.env.
 * Throws naming the first required variable that is missing or empty.
 */
export const loadEnv = (): SellerHubEnv => ({
  databaseUrl: requiredVar("DATABASE_URL"),
  redisUrl: requiredVar("REDIS_URL"),
  medusaBackendUrl: requiredVar("MEDUSA_BACKEND_URL"),
  medusaAdminEmail: requiredVar("MEDUSA_ADMIN_EMAIL"),
  medusaAdminPassword: requiredVar("MEDUSA_ADMIN_PASSWORD"),
  encryptionKey: requiredVar("ENCRYPTION_KEY"),
  awsRegion: optionalVar("AWS_REGION"),
  sqsQueueUrl: optionalVar("SQS_QUEUE_URL"),
  amazonLwaClientId: optionalVar("AMAZON_LWA_CLIENT_ID"),
  amazonLwaClientSecret: optionalVar("AMAZON_LWA_CLIENT_SECRET"),
})
