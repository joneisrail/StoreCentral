import type { Pool } from "pg"
import { SqsConsumer, type SqsClientLike } from "../sqs/consumer.js"
import { resolveAmazonSettings, type ResolvedAmazonSettings } from "./amazon-settings.js"

export type SqsFactory = (cfg: {
  region: string
  credentials: { accessKeyId: string; secretAccessKey: string } | null
}) => SqsClientLike & { getQueueAttributes(input: { QueueUrl: string }): Promise<unknown> }

export type AmazonRuntime = {
  /** Re-reads the settings and (re)starts or stops the SQS consumer. Never throws. */
  apply(): Promise<void>
  consumerRunning(): boolean
}

export const createAmazonRuntime = (deps: {
  pool: Pool
  encryptionKey: string
  env?: NodeJS.ProcessEnv
  makeSqs: SqsFactory
  /** Called with each successfully resolved settings snapshot, inside the serialized apply. */
  onApplied?: (settings: ResolvedAmazonSettings) => void
  onOrderChange: (amazonOrderId: string) => Promise<void>
}): AmazonRuntime => {
  let consumer: SqsConsumer | null = null
  // Tail of the apply chain: each apply() waits for the previous one.
  let chain: Promise<void> = Promise.resolve()

  const stop = (): void => {
    // An in-flight poll finishes with the old client; deleting its messages via that old client is correct.
    consumer?.stop()
    consumer = null
  }

  const applyOnce = async (): Promise<void> => {
    try {
      const settings = await resolveAmazonSettings(deps.pool, deps.encryptionKey, deps.env)
      try {
        deps.onApplied?.(settings)
      } catch (err) {
        console.error(
          `[seller-hub] Amazon settings callback failed (${err instanceof Error ? err.name : "Error"})`
        )
      }
      const region = settings.awsRegion.value
      const queueUrl = settings.sqsQueueUrl.value
      stop()
      if (!region || !queueUrl) {
        console.log("[seller-hub] Amazon SQS consumer not started (region or queue URL not set)")
        return
      }
      const sqs = deps.makeSqs({ region, credentials: settings.awsKeys })
      const next = new SqsConsumer({
        sqsClient: sqs,
        queueUrl,
        onOrderChange: deps.onOrderChange,
      })
      next.start()
      consumer = next
      console.log("[seller-hub] Amazon SQS consumer started")
    } catch (err) {
      // Name only: messages can carry credentials.
      console.error(
        `[seller-hub] could not apply Amazon settings (${err instanceof Error ? err.name : "Error"})`
      )
    }
  }

  return {
    apply: () => {
      const run = chain.then(applyOnce)
      chain = run
      return run
    },
    consumerRunning: () => consumer !== null,
  }
}
