import {
  Button,
  Container,
  Heading,
  StatusBadge,
  Text,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { ReactNode, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  MarketplaceConnection,
  useDisconnectMarketplaceConnection,
  useLinkMarketplaceConnection,
  useMarketplaceConnection,
  useTestMarketplaceConnection,
} from "../../../../../hooks/api/marketplace-connections"
import { MARKETPLACES } from "../../../components/marketplace-fields"
import { MarketplaceConnectDrawer } from "../marketplace-connect-drawer"
import { MarketplaceEditDrawer } from "../marketplace-edit-drawer"

type SalesChannelMarketplaceSectionProps = {
  salesChannelId: string
}

const STATUS_COLORS: Record<string, "green" | "red" | "grey" | "orange"> = {
  connected: "green",
  error: "red",
  disconnected: "grey",
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="grid grid-cols-2 items-start px-6 py-4 text-ui-fg-subtle">
    <Text size="small" leading="compact" weight="plus">
      {label}
    </Text>
    <div className="min-w-0 break-words text-ui-fg-subtle">{children}</div>
  </div>
)

const formatDate = (value: string | null) => {
  if (!value) {
    return null
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

const errorMessage = (error: unknown) =>
  (error as { message?: string } | null)?.message ?? ""

const ConnectionDetails = ({
  connection,
}: {
  connection: MarketplaceConnection
}) => {
  const { t } = useTranslation()
  const prompt = usePrompt()
  const [editing, setEditing] = useState(false)

  const test = useTestMarketplaceConnection(connection.id)
  const link = useLinkMarketplaceConnection(connection.id)
  const disconnect = useDisconnectMarketplaceConnection(connection.id)
  const busy = test.isPending || link.isPending || disconnect.isPending

  const def = MARKETPLACES[connection.marketplace]
  const actionsEnabled = !connection.read_only
  const syncLive = connection.sync_live

  const handleTest = async () => {
    try {
      const result = await test.mutateAsync()
      if (result?.ok === false) {
        toast.warning(
          t("salesChannels.marketplace.toast.testFailed", {
            message: result.message ?? "",
          })
        )
      } else {
        toast.success(t("salesChannels.marketplace.toast.testPassed"))
      }
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const handleLink = async () => {
    try {
      const result = (await link.mutateAsync()) as Record<string, unknown>
      const counts = {
        linked: Number(result?.linked ?? 0),
        alreadyLinked: Number(result?.already_linked ?? 0),
        unmatched: Number(result?.unmatched ?? 0),
        duplicates: Number(result?.duplicates ?? 0),
      }
      const message = t("salesChannels.marketplace.toast.linked", counts)
      if (counts.unmatched > 0 || counts.duplicates > 0) {
        toast.info(message)
      } else {
        toast.success(message)
      }
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const handleDisconnect = async () => {
    const confirmed = await prompt({
      title: t("general.areYouSure"),
      description: t("salesChannels.marketplace.disconnectWarning"),
      confirmText: t("salesChannels.marketplace.disconnect"),
      cancelText: t("actions.cancel"),
    })
    if (!confirmed) {
      return
    }
    try {
      await disconnect.mutateAsync()
      toast.success(t("salesChannels.marketplace.toast.disconnectedOk"))
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(connection.webhook_url ?? "")
      toast.success(t("salesChannels.marketplace.toast.copied"))
    } catch {
      toast.error(t("salesChannels.marketplace.toast.copyFailed"))
    }
  }

  const shownFields = def.fields.filter(
    (field) =>
      !field.secret && typeof connection.fields?.[field.name] === "string"
  )

  return (
    <>
      <Row label={t("salesChannels.marketplace.type")}>
        <Text size="small" leading="compact">
          {def.label}
        </Text>
      </Row>
      <Row label={t("salesChannels.marketplace.status")}>
        <StatusBadge color={STATUS_COLORS[connection.status] ?? "orange"}>
          {connection.status}
        </StatusBadge>
      </Row>
      {!syncLive ? (
        <Row label={t("salesChannels.marketplace.sync")}>
          <Text size="small" leading="compact">
            {t("salesChannels.marketplace.syncNotLive")}
          </Text>
        </Row>
      ) : null}
      <Row label={t("salesChannels.marketplace.lastSync")}>
        <Text size="small" leading="compact">
          {formatDate(connection.last_synced_at) ??
            t("salesChannels.marketplace.never")}
        </Text>
      </Row>
      <Row label={t("salesChannels.marketplace.linkedListings")}>
        <Text size="small" leading="compact">
          {connection.linked_listings}
        </Text>
      </Row>
      {connection.last_error ? (
        <Row label={t("salesChannels.marketplace.lastError")}>
          <Text size="small" leading="compact" className="text-ui-fg-error">
            {connection.last_error}
          </Text>
        </Row>
      ) : null}
      {shownFields.map((field) => (
        <Row key={field.name} label={field.label}>
          <Text size="small" leading="compact">
            {String(connection.fields[field.name])}
          </Text>
        </Row>
      ))}
      {connection.webhook_url ? (
        <Row label={t("salesChannels.marketplace.webhookUrl")}>
          <div className="flex items-center gap-x-2">
            <Text size="small" leading="compact" className="break-all">
              {connection.webhook_url}
            </Text>
            <Button
              size="small"
              variant="secondary"
              type="button"
              onClick={handleCopy}
            >
              {t("actions.copy")}
            </Button>
          </div>
        </Row>
      ) : null}
      {actionsEnabled ? (
        <div className="flex flex-wrap items-center gap-2 px-6 py-4">
          <Button
            size="small"
            variant="secondary"
            disabled={busy}
            onClick={() => setEditing(true)}
          >
            {t("salesChannels.marketplace.editCredentials")}
          </Button>
          <Button
            size="small"
            variant="secondary"
            disabled={busy || !syncLive}
            isLoading={test.isPending}
            onClick={handleTest}
          >
            {t("salesChannels.marketplace.test")}
          </Button>
          <Button
            size="small"
            variant="secondary"
            disabled={busy || !syncLive}
            isLoading={link.isPending}
            onClick={handleLink}
          >
            {t("salesChannels.marketplace.linkProducts")}
          </Button>
          <Button
            size="small"
            variant="danger"
            disabled={busy}
            isLoading={disconnect.isPending}
            onClick={handleDisconnect}
          >
            {t("salesChannels.marketplace.disconnect")}
          </Button>
        </div>
      ) : null}
      {actionsEnabled && editing ? (
        <MarketplaceEditDrawer
          connection={connection}
          open={editing}
          onOpenChange={setEditing}
        />
      ) : null}
    </>
  )
}

export const SalesChannelMarketplaceSection = ({
  salesChannelId,
}: SalesChannelMarketplaceSectionProps) => {
  const { t } = useTranslation()
  const [connecting, setConnecting] = useState(false)
  const { connection, isPending, isError, refetch } =
    useMarketplaceConnection(salesChannelId)

  let body: ReactNode
  if (isPending) {
    body = (
      <div className="px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">
          {t("salesChannels.marketplace.loading")}
        </Text>
      </div>
    )
  } else if (isError) {
    body = (
      <div
        role="alert"
        className="flex items-center justify-between gap-x-4 px-6 py-4"
      >
        <Text size="small" className="text-ui-fg-error">
          {t("salesChannels.marketplace.loadError")}
        </Text>
        <Button size="small" variant="secondary" onClick={() => refetch()}>
          {t("salesChannels.marketplace.retry")}
        </Button>
      </div>
    )
  } else if (!connection) {
    body = (
      <div className="flex items-center justify-between gap-x-4 px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">
          {t("salesChannels.marketplace.noConnection")}
        </Text>
        <Button
          size="small"
          variant="secondary"
          onClick={() => setConnecting(true)}
        >
          {t("salesChannels.marketplace.connect")}
        </Button>
        {connecting ? (
          <MarketplaceConnectDrawer
            salesChannelId={salesChannelId}
            open={connecting}
            onOpenChange={setConnecting}
          />
        ) : null}
      </div>
    )
  } else {
    body = <ConnectionDetails connection={connection} />
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">
          {t("salesChannels.marketplace.sectionTitle")}
        </Heading>
      </div>
      {body}
    </Container>
  )
}
