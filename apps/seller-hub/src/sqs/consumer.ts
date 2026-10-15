/**
 * Minimal surface of `@aws-sdk/client-sqs`'s `SQSClient` that this consumer
 * needs, expressed as plain methods rather than the real SDK's
 * command-object API so tests can inject a fake with no AWS dependency at
 * all (per the plan's Global Constraint "No live Amazon or AWS calls in
 * automated tests"). In real (Task 13) wiring, an adapter wraps the real
 * `SQSClient` to this shape, e.g.:
 *
 *   const sqsClientLike: SqsClientLike = {
 *     receiveMessage: (input) => sqsClient.send(new ReceiveMessageCommand(input)),
 *     deleteMessage: (input) => sqsClient.send(new DeleteMessageCommand(input)).then(() => undefined),
 *   }
 */
export type SqsClientLike = {
  receiveMessage(input: {
    QueueUrl: string
    MaxNumberOfMessages: number
    WaitTimeSeconds: number
  }): Promise<{ Messages?: { Body: string; ReceiptHandle: string }[] }>
  deleteMessage(input: { QueueUrl: string; ReceiptHandle: string }): Promise<void>
}

export type SqsConsumerDeps = {
  sqsClient: SqsClientLike
  queueUrl: string
  /**
   * Called with the Amazon order id from each ORDER_CHANGE notification.
   * In Task 13's real wiring this becomes
   * `(amazonOrderId) => orderSyncQueue.add("import", { amazonOrderId })`,
   * with a `createSyncWorker("order-sync", ..., async (job) => { const
   * order = await getOrder(spApiClient, job.data.amazonOrderId); await
   * importAmazonOrder(order, deps) })` processor consuming that queue on
   * the other end — see Task 10's brief, Step 6. `SqsConsumer` itself stays
   * dependency-free of the import/queue layer; it only knows how to turn an
   * SQS message into an Amazon order id and hand it off.
   */
  onOrderChange: (amazonOrderId: string) => Promise<void>
}

const POLL_INTERVAL_MS = 1_000

/**
 * Polls an SQS queue carrying Amazon's SP-API ORDER_CHANGE notifications
 * (see `docs/tutorial-subscribe-to-order-change-notification`) and invokes
 * `onOrderChange` with each notification's `AmazonOrderId`.
 *
 * The notification envelope shape consumed here --
 * `{ NotificationType: "ORDER_CHANGE", Payload: { OrderChangeNotification:
 * { AmazonOrderId } } }` -- matches Amazon's own published tutorial example
 * for this notification (confirmed against current SP-API Notifications
 * docs; the plan's open item about this shape being unverified is
 * resolved).
 *
 * A message whose body can't be parsed as JSON, or that's missing
 * `Payload.OrderChangeNotification.AmazonOrderId`, is logged and still
 * deleted (via the `finally` in `processMessage`) rather than left on the
 * queue -- an unparsable message will never become parsable by being
 * retried, so leaving it in place would just block the queue forever.
 * Likewise, a message whose `onOrderChange` call itself fails is still
 * deleted: this consumer's job is to notify, not to guarantee delivery
 * through to the eventual order-import workflow, and Task 13's queue layer
 * (BullMQ, with its own attempts/backoff) is what actually owns retrying
 * that downstream work.
 */
export class SqsConsumer {
  private readonly sqsClient: SqsClientLike
  private readonly queueUrl: string
  private readonly onOrderChange: (amazonOrderId: string) => Promise<void>
  private intervalHandle: ReturnType<typeof setInterval> | undefined
  private polling = false

  constructor(deps: SqsConsumerDeps) {
    this.sqsClient = deps.sqsClient
    this.queueUrl = deps.queueUrl
    this.onOrderChange = deps.onOrderChange
  }

  /**
   * Processes whatever messages are currently available from one
   * `receiveMessage` call, then returns -- it does not loop or long-poll
   * beyond that single call's `WaitTimeSeconds`. Used directly in tests;
   * `start()` is what repeatedly calls this for real usage.
   */
  async pollOnce(): Promise<void> {
    const response = await this.sqsClient.receiveMessage({
      QueueUrl: this.queueUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 1,
    })

    const messages = response.Messages ?? []
    for (const message of messages) {
      await this.processMessage(message)
    }
  }

  /**
   * Repeatedly calls `pollOnce()` on an interval. Guards against
   * overlapping polls (a slow `onOrderChange` on one tick doesn't cause a
   * second, concurrent `pollOnce()` on the next tick) by skipping a tick
   * entirely if the previous one hasn't finished yet.
   */
  start(): void {
    if (this.intervalHandle) {
      return
    }
    this.intervalHandle = setInterval(() => {
      void this.runPollTick()
    }, POLL_INTERVAL_MS)
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = undefined
    }
  }

  private async runPollTick(): Promise<void> {
    if (this.polling) {
      return
    }
    this.polling = true
    try {
      await this.pollOnce()
    } catch (err) {
      console.error("[sqs-consumer] pollOnce failed", err)
    } finally {
      this.polling = false
    }
  }

  private async processMessage(message: {
    Body: string
    ReceiptHandle: string
  }): Promise<void> {
    try {
      const amazonOrderId = parseAmazonOrderId(message.Body)
      if (!amazonOrderId) {
        console.error(
          "[sqs-consumer] malformed or unrecognized message body, skipping",
          message.Body
        )
        return
      }
      await this.onOrderChange(amazonOrderId)
    } catch (err) {
      console.error("[sqs-consumer] onOrderChange failed", err)
    } finally {
      await this.sqsClient.deleteMessage({
        QueueUrl: this.queueUrl,
        ReceiptHandle: message.ReceiptHandle,
      })
    }
  }
}

/**
 * Extracts `Payload.OrderChangeNotification.AmazonOrderId` from a raw SQS
 * message body, returning `null` for anything that isn't valid JSON or is
 * missing that field (rather than throwing), so the caller can log and move
 * on.
 */
const parseAmazonOrderId = (body: string): string | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return null
  }

  const amazonOrderId = (
    parsed as {
      Payload?: { OrderChangeNotification?: { AmazonOrderId?: unknown } }
    }
  )?.Payload?.OrderChangeNotification?.AmazonOrderId

  return typeof amazonOrderId === "string" ? amazonOrderId : null
}
