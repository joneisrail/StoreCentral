import type http from "node:http"
import type { Pool } from "pg"
import {
  AmazonSettingsInputError,
  clearAmazonSettings,
  invalidAmazonFields,
  resolveAmazonSettings,
  saveAmazonSettings,
  type AmazonSettingsInput,
  type ResolvedAmazonSettings,
} from "../settings/amazon-settings.js"
import type { AmazonRuntime, SqsFactory } from "../settings/amazon-runtime.js"
import { testSqsConnection } from "../settings/sqs-test.js"
import { readJsonBody, send } from "./http-helpers.js"

export type AmazonSettingsRouteDeps = {
  pool: Pool
  encryptionKey: string
  env?: NodeJS.ProcessEnv
  runtime: AmazonRuntime
  makeSqs: SqsFactory
}

const BODY_KEYS: Record<string, keyof AmazonSettingsInput> = {
  aws_region: "awsRegion",
  sqs_queue_url: "sqsQueueUrl",
  lwa_client_id: "lwaClientId",
  aws_access_key_id: "awsAccessKeyId",
  aws_secret_access_key: "awsSecretAccessKey",
  lwa_client_secret: "lwaClientSecret",
}

const SNAKE_BY_FIELD: Record<string, string> = Object.fromEntries(
  Object.entries(BODY_KEYS).map(([snake, camel]) => [camel, snake])
)

/** Returns null (after sending 400) for an unknown key or a non-string value. Never echoes input. */
const parseInput = async (
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<AmazonSettingsInput | null> => {
  const raw = (await readJsonBody(req, res)) as Record<string, unknown>
  const input: AmazonSettingsInput = {}
  for (const [key, value] of Object.entries(raw)) {
    const mapped = BODY_KEYS[key]
    if (!Object.hasOwn(BODY_KEYS, key) || typeof value !== "string") {
      send(res, 400, { error: "invalid_body" })
      return null
    }
    input[mapped] = value
  }
  return input
}

const view = async (deps: AmazonSettingsRouteDeps): Promise<Record<string, unknown>> => {
  const s = await resolveAmazonSettings(deps.pool, deps.encryptionKey, deps.env)
  return {
    aws_region: s.awsRegion,
    sqs_queue_url: s.sqsQueueUrl,
    lwa_client_id: s.lwaClientId,
    aws_access_key_id: { set: s.awsKeys !== null, source: s.awsKeysSource },
    aws_secret_access_key: { set: s.awsKeys !== null, source: s.awsKeysSource },
    lwa_client_secret: { set: s.lwaClientSecret.value !== null, source: s.lwaClientSecret.source },
    consumer_running: deps.runtime.consumerRunning(),
  }
}

const sendInputError = (res: http.ServerResponse, err: AmazonSettingsInputError): void => {
  send(res, 422, { error: "invalid_input", fields: err.fields.map((f) => SNAKE_BY_FIELD[f] ?? f), kind: err.kind })
}

const trimmed = (v: string | undefined): string => v?.trim() ?? ""

/** Overlays unsaved, non-blank body values on the effective settings; validates the overlay. */
const overlay = (base: ResolvedAmazonSettings, input: AmazonSettingsInput): ResolvedAmazonSettings => {
  const region = trimmed(input.awsRegion)
  const queueUrl = trimmed(input.sqsQueueUrl)
  const clientId = trimmed(input.lwaClientId)
  const invalid = invalidAmazonFields({ awsRegion: region, sqsQueueUrl: queueUrl, lwaClientId: clientId })
  if (invalid.length > 0) throw new AmazonSettingsInputError(invalid, undefined, "invalid")

  const stored = base.awsKeysSource === "database" ? base.awsKeys : null
  const keyId = trimmed(input.awsAccessKeyId) || stored?.accessKeyId || ""
  const secret = trimmed(input.awsSecretAccessKey) || stored?.secretAccessKey || ""
  if (Boolean(keyId) !== Boolean(secret)) {
    throw new AmazonSettingsInputError(
      [keyId ? "awsSecretAccessKey" : "awsAccessKeyId"],
      "The AWS key pair must be given together",
      "missing"
    )
  }
  const keysOverridden = Boolean(trimmed(input.awsAccessKeyId) || trimmed(input.awsSecretAccessKey))
  const lwaSecret = trimmed(input.lwaClientSecret)

  return {
    awsRegion: region ? { value: region, source: "database" } : base.awsRegion,
    sqsQueueUrl: queueUrl ? { value: queueUrl, source: "database" } : base.sqsQueueUrl,
    lwaClientId: clientId ? { value: clientId, source: "database" } : base.lwaClientId,
    awsKeys: keyId && secret ? { accessKeyId: keyId, secretAccessKey: secret } : null,
    awsKeysSource: keysOverridden ? "database" : base.awsKeysSource,
    lwaClientSecret: lwaSecret ? { value: lwaSecret, source: "database" } : base.lwaClientSecret,
  }
}

/** `rest` is the path after /internal/amazon-settings (empty, or ["test"]). */
export const handleAmazonSettings = async (
  deps: AmazonSettingsRouteDeps,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  rest: string[]
): Promise<void> => {
  const method = req.method ?? "GET"

  if (rest.length === 0) {
    if (method === "GET") return send(res, 200, await view(deps))
    if (method === "POST") {
      const input = await parseInput(req, res)
      if (!input) return
      try {
        await saveAmazonSettings(deps.pool, deps.encryptionKey, input)
      } catch (err) {
        if (err instanceof AmazonSettingsInputError) return sendInputError(res, err)
        throw err
      }
      await deps.runtime.apply()
      return send(res, 200, await view(deps))
    }
    if (method === "DELETE") {
      await clearAmazonSettings(deps.pool)
      await deps.runtime.apply()
      return send(res, 200, await view(deps))
    }
    return send(res, 405, { error: "method_not_allowed" })
  }

  if (rest.length === 1 && rest[0] === "test") {
    if (method !== "POST") return send(res, 405, { error: "method_not_allowed" })
    const input = await parseInput(req, res)
    if (!input) return
    let effective: ResolvedAmazonSettings
    try {
      effective = overlay(await resolveAmazonSettings(deps.pool, deps.encryptionKey, deps.env), input)
    } catch (err) {
      if (err instanceof AmazonSettingsInputError) return sendInputError(res, err)
      throw err
    }
    return send(res, 200, await testSqsConnection(effective, deps.makeSqs))
  }

  return send(res, 404, { error: "not_found" })
}
