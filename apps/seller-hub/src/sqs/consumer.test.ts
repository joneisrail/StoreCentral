import { afterEach, expect, test, vi } from "vitest"
import { SqsConsumer, type SqsClientLike } from "./consumer.js"

test("pollOnce calls onOrderChange for each ORDER_CHANGE notification and deletes the message", async () => {
  const fakeSqs: SqsClientLike = {
    receiveMessage: vi.fn().mockResolvedValue({
      Messages: [
        {
          Body: JSON.stringify({
            NotificationType: "ORDER_CHANGE",
            Payload: { OrderChangeNotification: { AmazonOrderId: "ORDER-ABC" } },
          }),
          ReceiptHandle: "rh-1",
        },
      ],
    }),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
  }
  const onOrderChange = vi.fn().mockResolvedValue(undefined)
  const consumer = new SqsConsumer({
    sqsClient: fakeSqs,
    queueUrl: "https://sqs.fake/queue",
    onOrderChange,
  })

  await consumer.pollOnce()

  expect(onOrderChange).toHaveBeenCalledWith("ORDER-ABC")
  expect(fakeSqs.deleteMessage).toHaveBeenCalledWith({
    QueueUrl: "https://sqs.fake/queue",
    ReceiptHandle: "rh-1",
  })
})

test("pollOnce deletes and skips a malformed message without throwing", async () => {
  const fakeSqs: SqsClientLike = {
    receiveMessage: vi
      .fn()
      .mockResolvedValue({ Messages: [{ Body: "not json", ReceiptHandle: "rh-2" }] }),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
  }
  const onOrderChange = vi.fn()
  const consumer = new SqsConsumer({
    sqsClient: fakeSqs,
    queueUrl: "https://sqs.fake/queue",
    onOrderChange,
  })

  await expect(consumer.pollOnce()).resolves.not.toThrow()

  expect(onOrderChange).not.toHaveBeenCalled()
  expect(fakeSqs.deleteMessage).toHaveBeenCalledWith({
    QueueUrl: "https://sqs.fake/queue",
    ReceiptHandle: "rh-2",
  })
})

test("pollOnce calls receiveMessage with the configured queue URL and polling params", async () => {
  const fakeSqs: SqsClientLike = {
    receiveMessage: vi.fn().mockResolvedValue({}),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
  }
  const consumer = new SqsConsumer({
    sqsClient: fakeSqs,
    queueUrl: "https://sqs.fake/queue",
    onOrderChange: vi.fn(),
  })

  await consumer.pollOnce()

  expect(fakeSqs.receiveMessage).toHaveBeenCalledWith({
    QueueUrl: "https://sqs.fake/queue",
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 1,
  })
})

test("pollOnce deletes a message with a missing AmazonOrderId without calling onOrderChange", async () => {
  const fakeSqs: SqsClientLike = {
    receiveMessage: vi.fn().mockResolvedValue({
      Messages: [
        {
          Body: JSON.stringify({ NotificationType: "ORDER_CHANGE", Payload: {} }),
          ReceiptHandle: "rh-3",
        },
      ],
    }),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
  }
  const onOrderChange = vi.fn()
  const consumer = new SqsConsumer({
    sqsClient: fakeSqs,
    queueUrl: "https://sqs.fake/queue",
    onOrderChange,
  })

  await expect(consumer.pollOnce()).resolves.not.toThrow()

  expect(onOrderChange).not.toHaveBeenCalled()
  expect(fakeSqs.deleteMessage).toHaveBeenCalledWith({
    QueueUrl: "https://sqs.fake/queue",
    ReceiptHandle: "rh-3",
  })
})

test("pollOnce still deletes the message when onOrderChange itself rejects", async () => {
  const fakeSqs: SqsClientLike = {
    receiveMessage: vi.fn().mockResolvedValue({
      Messages: [
        {
          Body: JSON.stringify({
            NotificationType: "ORDER_CHANGE",
            Payload: { OrderChangeNotification: { AmazonOrderId: "ORDER-FAIL" } },
          }),
          ReceiptHandle: "rh-4",
        },
      ],
    }),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
  }
  const onOrderChange = vi.fn().mockRejectedValue(new Error("downstream boom"))
  const consumer = new SqsConsumer({
    sqsClient: fakeSqs,
    queueUrl: "https://sqs.fake/queue",
    onOrderChange,
  })

  await expect(consumer.pollOnce()).resolves.not.toThrow()

  expect(fakeSqs.deleteMessage).toHaveBeenCalledWith({
    QueueUrl: "https://sqs.fake/queue",
    ReceiptHandle: "rh-4",
  })
})

test("pollOnce processes multiple messages in one batch, each deleted independently", async () => {
  const fakeSqs: SqsClientLike = {
    receiveMessage: vi.fn().mockResolvedValue({
      Messages: [
        {
          Body: JSON.stringify({
            NotificationType: "ORDER_CHANGE",
            Payload: { OrderChangeNotification: { AmazonOrderId: "ORDER-1" } },
          }),
          ReceiptHandle: "rh-a",
        },
        {
          Body: JSON.stringify({
            NotificationType: "ORDER_CHANGE",
            Payload: { OrderChangeNotification: { AmazonOrderId: "ORDER-2" } },
          }),
          ReceiptHandle: "rh-b",
        },
      ],
    }),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
  }
  const onOrderChange = vi.fn().mockResolvedValue(undefined)
  const consumer = new SqsConsumer({
    sqsClient: fakeSqs,
    queueUrl: "https://sqs.fake/queue",
    onOrderChange,
  })

  await consumer.pollOnce()

  expect(onOrderChange).toHaveBeenCalledWith("ORDER-1")
  expect(onOrderChange).toHaveBeenCalledWith("ORDER-2")
  expect(fakeSqs.deleteMessage).toHaveBeenCalledWith({
    QueueUrl: "https://sqs.fake/queue",
    ReceiptHandle: "rh-a",
  })
  expect(fakeSqs.deleteMessage).toHaveBeenCalledWith({
    QueueUrl: "https://sqs.fake/queue",
    ReceiptHandle: "rh-b",
  })
})

test("pollOnce resolves without calling onOrderChange or deleteMessage when there are no messages", async () => {
  const fakeSqs: SqsClientLike = {
    receiveMessage: vi.fn().mockResolvedValue({}),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
  }
  const onOrderChange = vi.fn()
  const consumer = new SqsConsumer({
    sqsClient: fakeSqs,
    queueUrl: "https://sqs.fake/queue",
    onOrderChange,
  })

  await consumer.pollOnce()

  expect(onOrderChange).not.toHaveBeenCalled()
  expect(fakeSqs.deleteMessage).not.toHaveBeenCalled()
})

let intervalConsumer: SqsConsumer | undefined
afterEach(() => {
  intervalConsumer?.stop()
  intervalConsumer = undefined
  vi.useRealTimers()
})

test("start() polls repeatedly on an interval and stop() halts further polling", async () => {
  vi.useFakeTimers()
  const fakeSqs: SqsClientLike = {
    receiveMessage: vi.fn().mockResolvedValue({}),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
  }
  intervalConsumer = new SqsConsumer({
    sqsClient: fakeSqs,
    queueUrl: "https://sqs.fake/queue",
    onOrderChange: vi.fn(),
  })

  intervalConsumer.start()
  await vi.advanceTimersByTimeAsync(5_000)
  const callsWhileRunning = (fakeSqs.receiveMessage as ReturnType<typeof vi.fn>).mock
    .calls.length
  expect(callsWhileRunning).toBeGreaterThan(0)

  intervalConsumer.stop()
  const callsAtStop = (fakeSqs.receiveMessage as ReturnType<typeof vi.fn>).mock.calls
    .length
  await vi.advanceTimersByTimeAsync(5_000)
  expect(
    (fakeSqs.receiveMessage as ReturnType<typeof vi.fn>).mock.calls.length
  ).toBe(callsAtStop)
})
