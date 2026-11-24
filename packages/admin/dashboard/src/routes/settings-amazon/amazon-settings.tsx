import {
  Alert,
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Label,
  Text,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  AmazonSettings,
  AmazonSettingSource,
  AmazonSettingsInput,
  AmazonSettingsKey,
  AmazonTestResult,
  useAmazonSettings,
  useClearAmazonSettings,
  useSaveAmazonSettings,
  useTestAmazonSettings,
} from "../../hooks/api/amazon-settings"

type FieldDef = {
  key: AmazonSettingsKey
  secret: boolean
  labelKey:
    | "awsRegion"
    | "sqsQueueUrl"
    | "lwaClientId"
    | "awsAccessKeyId"
    | "awsSecretAccessKey"
    | "lwaClientSecret"
}

const FIELDS: FieldDef[] = [
  { key: "aws_region", secret: false, labelKey: "awsRegion" },
  { key: "sqs_queue_url", secret: false, labelKey: "sqsQueueUrl" },
  { key: "lwa_client_id", secret: false, labelKey: "lwaClientId" },
  { key: "aws_access_key_id", secret: true, labelKey: "awsAccessKeyId" },
  {
    key: "aws_secret_access_key",
    secret: true,
    labelKey: "awsSecretAccessKey",
  },
  { key: "lwa_client_secret", secret: true, labelKey: "lwaClientSecret" },
]

type FormValues = Record<AmazonSettingsKey, string>
type FieldErrors = Partial<Record<AmazonSettingsKey, "invalid" | "missing">>

const EMPTY_FORM: FormValues = {
  aws_region: "",
  sqs_queue_url: "",
  lwa_client_id: "",
  aws_access_key_id: "",
  aws_secret_access_key: "",
  lwa_client_secret: "",
}

// Plain values start from what is stored; secrets always start empty.
const initialForm = (settings: AmazonSettings): FormValues => ({
  ...EMPTY_FORM,
  aws_region: settings.aws_region.value ?? "",
  sqs_queue_url: settings.sqs_queue_url.value ?? "",
  lwa_client_id: settings.lwa_client_id.value ?? "",
})

const errorMessage = (error: unknown) =>
  (error as { message?: string } | null)?.message ?? ""

// A 422 names the offending body keys; anything else has no field to blame.
const fieldErrorsOf = (error: unknown): FieldErrors | null => {
  const err = error as {
    status?: number
    fields?: unknown
    kind?: unknown
  } | null
  if (err?.status !== 422 || !Array.isArray(err.fields)) {
    return null
  }
  const kind = err.kind === "missing" ? "missing" : "invalid"
  const result: FieldErrors = {}
  for (const field of err.fields) {
    if (FIELDS.some((def) => def.key === field)) {
      result[field as AmazonSettingsKey] = kind
    }
  }
  return result
}

const SOURCE_KEYS = {
  database: "amazonSettings.source.database",
  environment: "amazonSettings.source.environment",
  none: "amazonSettings.source.none",
} as const

const SOURCE_COLORS: Record<AmazonSettingSource, "green" | "blue" | "grey"> = {
  database: "green",
  environment: "blue",
  none: "grey",
}

const nonBlank = (values: FormValues): AmazonSettingsInput => {
  const out: AmazonSettingsInput = {}
  for (const { key } of FIELDS) {
    if (values[key].trim() !== "") {
      out[key] = values[key]
    }
  }
  return out
}

const ErrorBanner = ({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) => {
  const { t } = useTranslation()
  return (
    <div role="alert" className="px-6 py-4">
      <Alert variant="error">
        <div className="flex items-center justify-between gap-x-4">
          <span className="break-words">
            {t("amazonSettings.loadError", { message })}
          </span>
          <Button size="small" variant="secondary" onClick={onRetry}>
            {t("amazonSettings.retry")}
          </Button>
        </div>
      </Alert>
    </div>
  )
}

const SettingsForm = ({ settings }: { settings: AmazonSettings }) => {
  const { t } = useTranslation()
  const prompt = usePrompt()
  const save = useSaveAmazonSettings()
  const test = useTestAmazonSettings()
  const clear = useClearAmazonSettings()

  const [values, setValues] = useState<FormValues>(() => initialForm(settings))
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [actionError, setActionError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<AmazonTestResult | null>(null)

  // Re-read after a save or clear: the stored values changed under the form.
  useEffect(() => {
    setValues(initialForm(settings))
  }, [settings])

  const busy = save.isPending || test.isPending || clear.isPending

  const changedInput = (): AmazonSettingsInput => {
    const base = initialForm(settings)
    const out: AmazonSettingsInput = {}
    for (const { key } of FIELDS) {
      if (values[key].trim() !== "" && values[key] !== base[key]) {
        out[key] = values[key]
      }
    }
    return out
  }
  const changed = Object.keys(changedInput()).length > 0

  const setValue = (key: AmazonSettingsKey, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }))
    setFieldErrors((prev) => ({ ...prev, [key]: undefined }))
  }

  const handleFailure = (error: unknown) => {
    const fields = fieldErrorsOf(error)
    if (fields) {
      setFieldErrors(fields)
      setActionError(null)
    } else {
      setActionError(errorMessage(error))
    }
  }

  const handleSave = async () => {
    setActionError(null)
    setFieldErrors({})
    try {
      await save.mutateAsync(changedInput())
      setTestResult(null)
      toast.success(t("amazonSettings.toast.saved"))
    } catch (error) {
      handleFailure(error)
    }
  }

  const handleTest = async () => {
    setActionError(null)
    setFieldErrors({})
    setTestResult(null)
    try {
      setTestResult(await test.mutateAsync(nonBlank(values)))
    } catch (error) {
      handleFailure(error)
    }
  }

  const handleClear = async () => {
    const confirmed = await prompt({
      title: t("general.areYouSure"),
      description: t("amazonSettings.clearWarning"),
      confirmText: t("amazonSettings.clear"),
      cancelText: t("actions.cancel"),
    })
    if (!confirmed) {
      return
    }
    setActionError(null)
    setFieldErrors({})
    setTestResult(null)
    try {
      await clear.mutateAsync()
      toast.success(t("amazonSettings.toast.cleared"))
    } catch (error) {
      handleFailure(error)
    }
  }

  return (
    <>
      <div className="px-6 py-4">
        <Text size="small" leading="compact" aria-live="polite">
          {settings.consumer_running
            ? t("amazonSettings.status.running")
            : t("amazonSettings.status.notRunning")}
        </Text>
      </div>
      <div className="flex flex-col gap-y-4 px-6 py-4">
        {FIELDS.map((def) => {
          const stored = settings[def.key]
          const id = `amazon-${def.key}`
          const error = fieldErrors[def.key]
          const isSet = "set" in stored ? stored.set : false
          return (
            <div key={def.key} className="flex flex-col gap-y-1">
              <div className="flex items-center gap-x-2">
                <Label htmlFor={id} size="small" weight="plus">
                  {t(`amazonSettings.fields.${def.labelKey}`)}
                </Label>
                {def.secret && isSet ? (
                  <Badge size="2xsmall" color="green">
                    {t("amazonSettings.set")}
                  </Badge>
                ) : null}
                <Badge size="2xsmall" color={SOURCE_COLORS[stored.source]}>
                  {t(SOURCE_KEYS[stored.source])}
                </Badge>
              </div>
              <Input
                id={id}
                size="small"
                type={def.secret ? "password" : "text"}
                autoComplete="off"
                value={values[def.key]}
                placeholder={
                  def.secret ? t("amazonSettings.leaveBlank") : undefined
                }
                disabled={busy}
                aria-invalid={error ? true : undefined}
                onChange={(e) => setValue(def.key, e.target.value)}
              />
              {error ? (
                <Text size="small" className="text-ui-fg-error" role="alert">
                  {error === "missing"
                    ? t("amazonSettings.fieldMissing")
                    : t("amazonSettings.fieldInvalid")}
                </Text>
              ) : null}
            </div>
          )
        })}
      </div>
      {actionError ? (
        <div role="alert" className="px-6 py-2">
          <Alert variant="error">
            <span className="break-words">{actionError}</span>
          </Alert>
        </div>
      ) : null}
      {testResult ? (
        <div className="px-6 py-2" aria-live="polite">
          {testResult.ok ? (
            <Alert variant="success">{t("amazonSettings.testPassed")}</Alert>
          ) : (
            <Alert variant="error">
              <span className="break-words">
                {testResult.message ||
                  t(`amazonSettings.testCodes.${testResult.code}`)}
              </span>
            </Alert>
          )}
        </div>
      ) : null}
      <div className="flex flex-col gap-y-2 px-6 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="small"
            disabled={busy || !changed}
            isLoading={save.isPending}
            onClick={handleSave}
          >
            {t("actions.save")}
          </Button>
          <Button
            size="small"
            variant="secondary"
            disabled={busy}
            isLoading={test.isPending}
            onClick={handleTest}
          >
            {t("amazonSettings.test")}
          </Button>
          <Button
            size="small"
            variant="danger"
            disabled={busy}
            isLoading={clear.isPending}
            onClick={handleClear}
          >
            {t("amazonSettings.clear")}
          </Button>
        </div>
        <Text size="small" className="text-ui-fg-subtle">
          {t("amazonSettings.testHint")}
        </Text>
      </div>
    </>
  )
}

export const AmazonSettingsPage = () => {
  const { t } = useTranslation()
  const query = useAmazonSettings()

  let body
  if (query.isError) {
    // No stale values next to an error: show the banner alone.
    body = (
      <ErrorBanner
        message={errorMessage(query.error)}
        onRetry={() => query.refetch?.()}
      />
    )
  } else if (!query.data) {
    body = (
      <div className="px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">
          {t("amazonSettings.loading")}
        </Text>
      </div>
    )
  } else {
    body = <SettingsForm settings={query.data} />
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col px-6 py-4">
        <Heading level="h1">{t("amazonSettings.domain")}</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {t("amazonSettings.subtitle")}
        </Text>
      </div>
      {body}
    </Container>
  )
}
