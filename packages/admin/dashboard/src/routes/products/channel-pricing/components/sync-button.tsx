import { ArrowPath, CheckCircleSolid, ExclamationCircle } from "@medusajs/icons"
import { useState } from "react"
import { useTranslation } from "react-i18next"

type SyncButtonProps = {
  channelName: string
  /** False for web store, POS and unconnected channels: shown as "live". */
  hasConnection: boolean
  state: string | null
  onSync: () => Promise<unknown>
}

export const SyncButton = ({
  channelName,
  hasConnection,
  state,
  onSync,
}: SyncButtonProps) => {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  if (!hasConnection) {
    return (
      <span className="text-xs text-ui-fg-muted">
        {t("channelPricing.live")}
      </span>
    )
  }

  const run = async () => {
    if (busy) {
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      await onSync()
    } catch (e) {
      setMessage(
        e instanceof Error && e.message
          ? e.message
          : t("channelPricing.sync.failed")
      )
    } finally {
      setBusy(false)
    }
  }

  const amber = state === "pending" || state === "failed"
  const Icon = busy
    ? ArrowPath
    : state === "failed"
      ? ExclamationCircle
      : state === "pending"
        ? ArrowPath
        : CheckCircleSolid
  const tone =
    state === "failed"
      ? "text-ui-fg-error"
      : amber
        ? "text-ui-tag-orange-icon"
        : "text-ui-tag-green-icon"

  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        aria-label={t("channelPricing.sync.label")}
        title={`${t("channelPricing.sync.label")} (${channelName})`}
        aria-busy={busy}
        disabled={busy}
        onClick={() => void run()}
        className={tone}
      >
        <Icon className={busy ? "animate-spin" : undefined} />
      </button>
      {message && (
        <span role="alert" className="max-w-[16rem] text-xs text-ui-fg-error">
          {message}
        </span>
      )}
    </span>
  )
}
