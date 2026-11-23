import { Alert, Button, Checkbox, Table, Text } from "@medusajs/ui"
import { ReactNode, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  ImportOutcome,
  ImportPreview,
  MarketplaceKey,
  useImportPreview,
  useRunImport,
} from "../../../../../hooks/api/marketplace-connections"

type ChannelImportPanelProps = {
  connectionId: string
  marketplace: MarketplaceKey | string
}

// Amazon has no listing read to import from.
const IMPORTABLE = new Set(["shopify", "woocommerce"])

// How many failure messages to list under the outcome counts.
const SHOWN_FAILURES = 5

const errorMessage = (error: unknown) =>
  (error as { message?: string } | null)?.message ?? ""

const ErrorAlert = ({
  message,
  onRetry,
  retryLabel,
}: {
  message: string
  onRetry?: () => void
  retryLabel?: string
}) => (
  <div role="alert" className="px-6 py-4">
    <Alert variant="error">
      <div className="flex items-center justify-between gap-x-4">
        <span className="break-words">{message}</span>
        {onRetry ? (
          <Button size="small" variant="secondary" onClick={onRetry}>
            {retryLabel}
          </Button>
        ) : null}
      </div>
    </Alert>
  </div>
)

const Counts = ({ preview }: { preview: ImportPreview }) => {
  const { t } = useTranslation()
  const groups = [
    ["matched", preview.matched_total],
    ["toImport", preview.unmatched_total],
    ["duplicates", preview.duplicates_total],
    ["noSku", preview.no_sku_total],
  ] as const
  return (
    <div className="grid grid-cols-2 gap-2 px-6 py-4 md:grid-cols-4">
      {groups.map(([key, count]) => (
        <Text key={key} size="small" leading="compact" weight="plus">
          {t(`salesChannels.marketplace.import.${key}`, { count })}
        </Text>
      ))}
    </div>
  )
}

type OutcomeKey =
  | "imported"
  | "failed"
  | "skippedAlreadyLinked"
  | "skippedMatched"
  | "skippedCurrency"
  | "deferred"

const Outcome = ({ outcome }: { outcome: ImportOutcome }) => {
  const { t } = useTranslation()
  const skipped = outcome.skipped_counts
  const lines: [OutcomeKey, number][] = [
    ["imported", outcome.imported.length],
    ["failed", outcome.failed_total],
    ["skippedAlreadyLinked", skipped.already_linked],
    ["skippedMatched", skipped.matched],
    ["skippedCurrency", skipped.currency],
    ["deferred", outcome.deferred_total],
  ]
  return (
    <div className="flex flex-col gap-y-1 px-6 py-4" aria-live="polite">
      {lines
        .filter(([key, count]) => key === "imported" || count > 0)
        .map(([key, count]) => (
          <Text key={key} size="small" leading="compact">
            {t(`salesChannels.marketplace.import.${key}`, { count })}
          </Text>
        ))}
      {outcome.failed.slice(0, SHOWN_FAILURES).map((f, i) => (
        <Text
          key={`${f.sku}-${i}`}
          size="small"
          leading="compact"
          className="break-words text-ui-fg-error"
        >
          {`${f.sku}: ${f.message}`}
        </Text>
      ))}
      {outcome.deferred_total > 0 ? (
        <Text size="small" leading="compact" className="text-ui-fg-subtle">
          {t("salesChannels.marketplace.import.deferredHint")}
        </Text>
      ) : null}
    </div>
  )
}

const ImportPanelBody = ({ connectionId }: { connectionId: string }) => {
  const { t } = useTranslation()
  const [requested, setRequested] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)
  const [runError, setRunError] = useState<string | null>(null)

  const preview = useImportPreview(connectionId, { enabled: requested })
  const run = useRunImport(connectionId)
  const busy = run.isPending

  const handleCheck = () => {
    if (requested) {
      preview.refetch?.()
    } else {
      setRequested(true)
    }
  }

  const toggle = (sku: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) {
        next.add(sku)
      } else {
        next.delete(sku)
      }
      return next
    })
  }

  const runImport = async (skus: "all" | string[]) => {
    setRunError(null)
    try {
      const result = await run.mutateAsync({ skus })
      setOutcome(result)
      setSelected(new Set())
    } catch (error) {
      setRunError(errorMessage(error))
    }
  }

  const data = requested ? preview.data : undefined

  let body: ReactNode = null
  if (requested && preview.isError) {
    body = (
      <ErrorAlert
        message={errorMessage(preview.error)}
        onRetry={() => preview.refetch?.()}
        retryLabel={t("salesChannels.marketplace.import.retry")}
      />
    )
  } else if (requested && !data) {
    body = (
      <div className="px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">
          {t("salesChannels.marketplace.import.loading")}
        </Text>
      </div>
    )
  } else if (data) {
    const rows = data.unmatched
    body = (
      <>
        <Counts preview={data} />
        {rows.length > 0 ? (
          <div className="px-6 py-4">
            {data.unmatched_total > rows.length ? (
              <Text size="small" className="mb-2 text-ui-fg-subtle">
                {t("salesChannels.marketplace.import.rowsCapped", {
                  count: rows.length,
                })}
              </Text>
            ) : null}
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell />
                  <Table.HeaderCell>
                    {t("salesChannels.marketplace.import.sku")}
                  </Table.HeaderCell>
                  <Table.HeaderCell>
                    {t("salesChannels.marketplace.import.titleColumn")}
                  </Table.HeaderCell>
                  <Table.HeaderCell>
                    {t("salesChannels.marketplace.import.price")}
                  </Table.HeaderCell>
                  <Table.HeaderCell>
                    {t("salesChannels.marketplace.import.stock")}
                  </Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {rows.map((row) => (
                  <Table.Row key={row.sku}>
                    <Table.Cell>
                      <Checkbox
                        aria-label={row.sku}
                        checked={selected.has(row.sku)}
                        disabled={busy}
                        onCheckedChange={(value) =>
                          toggle(row.sku, value === true)
                        }
                      />
                    </Table.Cell>
                    <Table.Cell>{row.sku}</Table.Cell>
                    <Table.Cell>{row.title}</Table.Cell>
                    <Table.Cell>{row.price}</Table.Cell>
                    <Table.Cell>{row.stock ?? "-"}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 px-6 py-4">
          <Button
            size="small"
            variant="secondary"
            disabled={busy || selected.size === 0}
            isLoading={busy}
            onClick={() => runImport(Array.from(selected))}
          >
            {t("salesChannels.marketplace.import.importSelected", {
              count: selected.size,
            })}
          </Button>
          <Button
            size="small"
            variant="secondary"
            disabled={busy || data.unmatched_total === 0}
            onClick={() => runImport("all")}
          >
            {t("salesChannels.marketplace.import.importAll", {
              count: data.unmatched_total,
            })}
          </Button>
        </div>
      </>
    )
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-x-4 px-6 py-4">
        <div className="flex flex-col">
          <Text size="small" leading="compact" weight="plus">
            {t("salesChannels.marketplace.import.title")}
          </Text>
          <Text size="small" className="text-ui-fg-subtle">
            {t("salesChannels.marketplace.import.hint")}
          </Text>
        </div>
        <Button
          size="small"
          variant="secondary"
          disabled={busy}
          isLoading={requested && preview.isFetching}
          onClick={handleCheck}
        >
          {t("salesChannels.marketplace.import.check")}
        </Button>
      </div>
      {body}
      {runError ? <ErrorAlert message={runError} /> : null}
      {outcome ? <Outcome outcome={outcome} /> : null}
    </div>
  )
}

export const ChannelImportPanel = ({
  connectionId,
  marketplace,
}: ChannelImportPanelProps) => {
  if (!IMPORTABLE.has(marketplace)) {
    return null
  }
  return <ImportPanelBody connectionId={connectionId} />
}
