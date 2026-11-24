import { FetchError } from "@medusajs/js-sdk"
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
} from "@tanstack/react-query"
import { sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"

const BASE_PATH = "/admin/amazon-settings"

export const amazonSettingsQueryKey = ["amazon-settings"] as const

export type AmazonSettingSource = "database" | "environment" | "none"

export type AmazonPlainSetting = {
  value: string | null
  source: AmazonSettingSource
}

// Secrets never come back, only whether one is stored.
export type AmazonSecretSetting = {
  set: boolean
  source: AmazonSettingSource
}

export type AmazonSettings = {
  aws_region: AmazonPlainSetting
  sqs_queue_url: AmazonPlainSetting
  lwa_client_id: AmazonPlainSetting
  aws_access_key_id: AmazonSecretSetting
  aws_secret_access_key: AmazonSecretSetting
  lwa_client_secret: AmazonSecretSetting
  consumer_running: boolean
}

export type AmazonSettingsKey =
  | "aws_region"
  | "sqs_queue_url"
  | "lwa_client_id"
  | "aws_access_key_id"
  | "aws_secret_access_key"
  | "lwa_client_secret"

// Any subset; blank or absent keeps the stored value.
export type AmazonSettingsInput = Partial<Record<AmazonSettingsKey, string>>

export type AmazonTestFailureCode =
  | "not_configured"
  | "invalid_credentials"
  | "queue_not_found"
  | "access_denied"
  | "unreachable"

export type AmazonTestResult =
  { ok: true } | { ok: false; code: AmazonTestFailureCode; message: string }

export const useAmazonSettings = (
  options?: Omit<
    UseQueryOptions<AmazonSettings, FetchError, AmazonSettings, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  return useQuery({
    queryKey: amazonSettingsQueryKey,
    queryFn: () =>
      sdk.client.fetch<AmazonSettings>(BASE_PATH, { method: "GET" }),
    ...options,
  })
}

const invalidateSettings = () =>
  queryClient.invalidateQueries({ queryKey: amazonSettingsQueryKey })

export const useSaveAmazonSettings = (
  options?: UseMutationOptions<AmazonSettings, FetchError, AmazonSettingsInput>
) => {
  return useMutation({
    mutationFn: (payload) =>
      sdk.client.fetch<AmazonSettings>(BASE_PATH, {
        method: "POST",
        body: payload,
      }),
    ...options,
    onSuccess: (data, variables, context) => {
      invalidateSettings()
      options?.onSuccess?.(data, variables, context)
    },
  })
}

export const useClearAmazonSettings = (
  options?: UseMutationOptions<unknown, FetchError, void>
) => {
  return useMutation({
    mutationFn: () =>
      sdk.client.fetch<unknown>(BASE_PATH, { method: "DELETE" }),
    ...options,
    onSuccess: (data, variables, context) => {
      invalidateSettings()
      options?.onSuccess?.(data, variables, context)
    },
  })
}

// Tests the typed values on top of the stored ones; nothing is saved.
export const useTestAmazonSettings = (
  options?: UseMutationOptions<
    AmazonTestResult,
    FetchError,
    AmazonSettingsInput
  >
) => {
  return useMutation({
    mutationFn: (payload) =>
      sdk.client.fetch<AmazonTestResult>(`${BASE_PATH}/test`, {
        method: "POST",
        body: payload,
      }),
    ...options,
  })
}
