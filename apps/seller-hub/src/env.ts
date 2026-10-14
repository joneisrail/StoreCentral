export type SellerHubEnv = {
  databaseUrl: string
  redisUrl: string
  medusaBackendUrl: string
  medusaAdminEmail: string
  medusaAdminPassword: string
  encryptionKey: string // 32-byte hex string, used by the crypto helper
  awsRegion: string
  sqsQueueUrl: string
  amazonLwaClientId: string
  amazonLwaClientSecret: string
}

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
  awsRegion: requiredVar("AWS_REGION"),
  sqsQueueUrl: requiredVar("SQS_QUEUE_URL"),
  amazonLwaClientId: requiredVar("AMAZON_LWA_CLIENT_ID"),
  amazonLwaClientSecret: requiredVar("AMAZON_LWA_CLIENT_SECRET"),
})
