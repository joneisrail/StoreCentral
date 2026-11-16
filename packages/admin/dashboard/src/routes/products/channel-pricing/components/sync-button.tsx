import { ArrowPath, CheckCircleSolid, ExclamationCircle } from "@medusajs/icons"
import { useId, useState } from "react"
import { useTranslation } from "react-i18next"

type SyncButtonProps = {
  channelName: string
  /** Web store and POS channels are "live" and never need a sync. */
  live?: boolean
  /** False for a marketplace without a connection: "Not connected". */
  hasConnection: boolean
  /** last_error of a failed cell, announced with the retry button. */
  error?: string | null
  state: string | null
  onSync: () => Promise<unknown>
}

export const SyncButton = ({
  channelName,
  live,
  hasConnection,
  error,
  state,
  onSync,
}: SyncButtonProps) => {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const errorId = useId()

  if (!live && !hasConnection) {
    return (
      <span className="text-xs text-ui-fg-muted">
        {t("channelPricing.notConnected")}
      </span>
    )
  }

  if (live) {
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
        aria-label={
          state === "failed"
            ? t("channelPricing.sync.retry", { channel: channelName })
            : t("channelPricing.sync.label", { channel: channelName })
        }
        aria-describedby={state === "failed" && error ? errorId : undefined}
        aria-busy={busy}
        disabled={busy}
        onClick={() => void run()}
        className={tone}
      >
        <Icon className={busy ? "animate-spin" : undefined} />
      </button>
      {state === "failed" && error ? (
        <span id={errorId} className="sr-only">
          {error}
        </span>
      ) : null}
      {message && (
        <span role="alert" className="max-w-[16rem] text-xs text-ui-fg-error">
          {message}
        </span>
      )}
    </span>
  )
}
