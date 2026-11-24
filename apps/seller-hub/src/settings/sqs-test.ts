import type { ResolvedAmazonSettings } from "./amazon-settings.js"
import type { SqsFactory } from "./amazon-runtime.js"

export type SqsTestResult =
  | { ok: true }
  | {
      ok: false
      code:
        | "not_configured"
        | "invalid_credentials"
        | "queue_not_found"
        | "access_denied"
        | "unreachable"
      message: string
    }

type FailureCode = Extract<SqsTestResult, { ok: false }>["code"]

// Fixed messages: AWS error text is never returned, it can echo identifiers.
const MESSAGES: Record<FailureCode, string> = {
  not_configured: "Set the AWS region and the SQS queue URL first.",
  invalid_credentials: "AWS rejected the access key or secret.",
  queue_not_found: "The queue was not found. Check the queue URL and region.",
  access_denied: "These AWS credentials are not allowed to read this queue.",
  unreachable: "Could not reach Amazon SQS. Try again in a moment.",
}

const CODE_BY_ERROR_NAME: Record<string, FailureCode> = {
  InvalidClientTokenId: "invalid_credentials",
  UnrecognizedClientException: "invalid_credentials",
  SignatureDoesNotMatch: "invalid_credentials",
  AuthFailure: "invalid_credentials",
  ExpiredToken: "invalid_credentials",
  ExpiredTokenException: "invalid_credentials",
  InvalidSignatureException: "invalid_credentials",
  CredentialsProviderError: "invalid_credentials",
  "AWS.SimpleQueueService.NonExistentQueue": "queue_not_found",
  QueueDoesNotExist: "queue_not_found",
  AccessDenied: "access_denied",
  AccessDeniedException: "access_denied",
}

const fail = (code: FailureCode): SqsTestResult => ({
  ok: false,
  code,
  message: MESSAGES[code],
})

export const testSqsConnection = async (
  settings: ResolvedAmazonSettings,
  makeSqs: SqsFactory,
  timeoutMs = 10_000
): Promise<SqsTestResult> => {
  const region = settings.awsRegion.value
  const queueUrl = settings.sqsQueueUrl.value
  if (!region || !queueUrl) return fail("not_configured")

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const sqs = makeSqs({ region, credentials: settings.awsKeys })
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), timeoutMs)
    })
    await Promise.race([sqs.getQueueAttributes({ QueueUrl: queueUrl }), timeout])
    return { ok: true }
  } catch (err) {
    const name = err instanceof Error ? err.name : ""
    return fail(CODE_BY_ERROR_NAME[name] ?? "unreachable")
  } finally {
    if (timer) clearTimeout(timer)
  }
}
