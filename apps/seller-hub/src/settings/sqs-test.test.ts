import { describe, expect, test } from "vitest"
import type { ResolvedAmazonSettings } from "./amazon-settings.js"
import type { SqsFactory } from "./amazon-runtime.js"
import { testSqsConnection } from "./sqs-test.js"

const settings = (over: Partial<ResolvedAmazonSettings> = {}): ResolvedAmazonSettings => ({
  awsRegion: { value: "us-east-1", source: "database" },
  sqsQueueUrl: { value: "https://sqs.us-east-1.amazonaws.com/1/q", source: "database" },
  lwaClientId: { value: null, source: "none" },
  awsKeys: null,
  awsKeysSource: "none",
  lwaClientSecret: { value: null, source: "none" },
  ...over,
})

const factoryWith = (getQueueAttributes: () => Promise<unknown>): SqsFactory => () => ({
  receiveMessage: async () => ({}),
  deleteMessage: async () => undefined,
  getQueueAttributes,
})

const namedError = (name: string, message: string): Error => {
  const e = new Error(message)
  e.name = name
  return e
}

describe("testSqsConnection", () => {
  test("ok", async () => {
    expect(await testSqsConnection(settings(), factoryWith(async () => ({})))).toEqual({ ok: true })
  })

  test("not configured without region or queue url", async () => {
    const r = await testSqsConnection(
      settings({ sqsQueueUrl: { value: null, source: "none" } }),
      factoryWith(async () => ({}))
    )
    expect(r).toMatchObject({ ok: false, code: "not_configured" })
  })

  test("each error name maps to its code", async () => {
    const cases: [string, string][] = [
      ["InvalidClientTokenId", "invalid_credentials"],
      ["SignatureDoesNotMatch", "invalid_credentials"],
      ["UnrecognizedClientException", "invalid_credentials"],
      ["AWS.SimpleQueueService.NonExistentQueue", "queue_not_found"],
      ["QueueDoesNotExist", "queue_not_found"],
      ["AccessDenied", "access_denied"],
      ["AccessDeniedException", "access_denied"],
      ["TimeoutError", "unreachable"],
      ["SomethingElse", "unreachable"],
    ]
    for (const [name, code] of cases) {
      const r = await testSqsConnection(
        settings(),
        factoryWith(async () => {
          throw namedError(name, "x")
        })
      )
      expect(r).toMatchObject({ ok: false, code })
    }
  })

  test("timeout maps to unreachable", async () => {
    const r = await testSqsConnection(
      settings(),
      factoryWith(() => new Promise(() => undefined)),
      20
    )
    expect(r).toMatchObject({ ok: false, code: "unreachable" })
  })

  test("message never contains the AWS error text", async () => {
    const secretText = "arn:aws:iam::123456789012:user/secret-person AKIALEAKED"
    for (const name of ["AccessDenied", "InvalidClientTokenId", "QueueDoesNotExist", "Other"]) {
      const r = await testSqsConnection(
        settings(),
        factoryWith(async () => {
          throw namedError(name, secretText)
        })
      )
      expect(JSON.stringify(r)).not.toContain("AKIALEAKED")
      expect(JSON.stringify(r)).not.toContain("secret-person")
    }
  })
})
