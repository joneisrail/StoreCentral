import { Alert, Button, Table, Text } from "@medusajs/ui"
import { ReactNode } from "react"
import { useTranslation } from "react-i18next"

import {
  MarketplaceKey,
  SyncKind,
  SyncStatus,
  useSyncStatus,
} from "../../../../../hooks/api/marketplace-connections"

type ChannelSyncStatusPanelProps = {
  connectionId: string
  marketplace: MarketplaceKey | string
}

// Amazon has no seller-hub sync to report on.
const HIDDEN = new Set(["amazon"])

// Fixed display order of the job kinds.
const KINDS: SyncKind[] = ["product", "inventory", "price", "order", "tracking"]

const K = "salesChannels.marketplace.syncStatus"

const errorMessage = (error: unknown) =>
  (error as { message?: string } | null)?.message ?? ""

const formatDate = (value: string | null) => {
  if (!value) {
    return null
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

const ListingCounts = ({ listings }: { listings: SyncStatus["listings"] }) => {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-1 px-6 py-4">
      <Text size="small" leading="compact" weight="plus">
        {t(`${K}.listingsTotal`, { count: listings.total })}
      </Text>
      {Object.entries(listings.by_status).map(([status, count]) => (
        <Text key={status} size="small" leading="compact">
          {t(`${K}.listingsByStatus`, { status, count })}
        </Text>
      ))}
      <Text size="small" leading="compact">
        {t(`${K}.withError`, { count: listings.with_error })}
      </Text>
      <Text size="small" leading="compact">
        {t(`${K}.neverPushed`, { count: listings.never_pushed })}
      </Text>
    </div>
  )
}

const JobsTable = ({ jobs }: { jobs: SyncStatus["jobs"] }) => {
  const { t } = useTranslation()
  return (
    <div className="px-6 py-4">
      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>{t(`${K}.kind`)}</Table.HeaderCell>
            <Table.HeaderCell>{t(`${K}.pending`)}</Table.HeaderCell>
            <Table.HeaderCell>{t(`${K}.processing`)}</Table.HeaderCell>
            <Table.HeaderCell>{t(`${K}.failed`)}</Table.HeaderCell>
            <Table.HeaderCell>{t(`${K}.lastSuccess`)}</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {KINDS.map((kind) => {
            const counts = jobs.by_type[kind]
            return (
              <Table.Row key={kind}>
                <Table.Cell>{t(`${K}.kinds.${kind}`)}</Table.Cell>
                <Table.Cell>{counts?.pending ?? 0}</Table.Cell>
                <Table.Cell>{counts?.processing ?? 0}</Table.Cell>
                <Table.Cell>{counts?.failed ?? 0}</Table.Cell>
                <Table.Cell>
                  {formatDate(jobs.last_succeeded_at[kind] ?? null) ??
                    t(`${K}.never`)}
                </Table.Cell>
              </Table.Row>
            )
          })}
        </Table.Body>
      </Table>
    </div>
  )
}

const FailuresTable = ({ data }: { data: SyncStatus }) => {
  const { t } = useTranslation()
  const rows = data.recent_failures
  return (
    <div className="flex flex-col gap-y-2 px-6 py-4">
      <Text size="small" leading="compact" weight="plus">
        {t(`${K}.failuresTitle`)}
      </Text>
      {rows.length === 0 ? (
        <Text size="small" className="text-ui-fg-subtle">
          {t(`${K}.noFailures`)}
        </Text>
      ) : (
        <>
          {data.failures_total > rows.length ? (
            <Text size="small" className="text-ui-fg-subtle">
              {t(`${K}.failuresShown`, {
                shown: rows.length,
                total: data.failures_total,
              })}
            </Text>
          ) : null}
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>{t(`${K}.kind`)}</Table.HeaderCell>
                <Table.HeaderCell>{t(`${K}.externalId`)}</Table.HeaderCell>
                <Table.HeaderCell>{t(`${K}.attempts`)}</Table.HeaderCell>
                <Table.HeaderCell>{t(`${K}.message`)}</Table.HeaderCell>
                <Table.HeaderCell>{t(`${K}.time`)}</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((row, i) => (
                <Table.Row key={`${row.sync_type}-${row.external_id}-${i}`}>
                  <Table.Cell>
                    {KINDS.includes(row.sync_type as SyncKind)
                      ? t(`${K}.kinds.${row.sync_type}`)
                      : row.sync_type}
                  </Table.Cell>
                  <Table.Cell>{row.external_id}</Table.Cell>
                  <Table.Cell>{row.attempts}</Table.Cell>
                  <Table.Cell className="break-words">
                    {row.last_error ?? "-"}
                  </Table.Cell>
                  <Table.Cell>
                    {formatDate(row.updated_at) ?? row.updated_at}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </>
      )}
    </div>
  )
}

const SyncStatusBody = ({ connectionId }: { connectionId: string }) => {
  const { t } = useTranslation()
  const status = useSyncStatus(connectionId)

  let body: ReactNode
  if (status.isError) {
    // No numbers at all on an error, not even the last good ones: a stale
    // count would look current.
    body = (
      <div role="alert" className="px-6 py-4">
        <Alert variant="error">
          <div className="flex items-center justify-between gap-x-4">
            <span className="break-words">
              {t(`${K}.unavailable`, { message: errorMessage(status.error) })}
            </span>
            <Button
              size="small"
              variant="secondary"
              onClick={() => status.refetch()}
            >
              {t(`${K}.retry`)}
            </Button>
          </div>
        </Alert>
      </div>
    )
  } else if (!status.data) {
    body = (
      <div className="px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">
          {t(`${K}.loading`)}
        </Text>
      </div>
    )
  } else {
    const data = status.data
    body = (
      <>
        {!data.sync_live ? (
          <div className="px-6 py-4">
            <Alert variant="warning">{t(`${K}.notRunning`)}</Alert>
          </div>
        ) : null}
        <ListingCounts listings={data.listings} />
        <JobsTable jobs={data.jobs} />
        <FailuresTable data={data} />
      </>
    )
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-x-4 px-6 py-4">
        <div className="flex flex-col">
          <Text size="small" leading="compact" weight="plus">
            {t(`${K}.title`)}
          </Text>
          <Text size="small" className="text-ui-fg-subtle">
            {t(`${K}.hint`)}
          </Text>
        </div>
        <Button
          size="small"
          variant="secondary"
          isLoading={status.isFetching}
          onClick={() => status.refetch()}
        >
          {t(`${K}.refresh`)}
        </Button>
      </div>
      {body}
    </div>
  )
}

export const ChannelSyncStatusPanel = ({
  connectionId,
  marketplace,
}: ChannelSyncStatusPanelProps) => {
  if (HIDDEN.has(marketplace)) {
    return null
  }
  return <SyncStatusBody connectionId={connectionId} />
}
