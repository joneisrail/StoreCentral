import { Pencil } from "@medusajs/icons"
import { KeyboardEvent, useId, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

export type EditableCellKind = "price" | "stock"

const PRICE_PATTERN = /^\d+(\.\d{1,2})?$/
const STOCK_PATTERN = /^\d+$/
const MAX_VALUE = 1_000_000

type Parsed = { ok: true; value: number | null } | { ok: false }

const parse = (kind: EditableCellKind, raw: string): Parsed => {
  const text = raw.trim()
  if (kind === "price") {
    // An empty price clears the channel price, so it falls back to the base.
    if (text === "") {
      return { ok: true, value: null }
    }
    return PRICE_PATTERN.test(text) && Number(text) <= MAX_VALUE
      ? { ok: true, value: Number(text) }
      : { ok: false }
  }
  return STOCK_PATTERN.test(text) && Number(text) <= MAX_VALUE
    ? { ok: true, value: Number(text) }
    : { ok: false }
}

type EditableCellProps = {
  kind: EditableCellKind
  /** Current value, used to seed the input and skip no-op saves. */
  value: number | null
  /** Formatted text shown when not editing. */
  display: string
  /** Accessible name of the pencil button, e.g. "Edit Shopify price". */
  label: string
  readOnly?: boolean
  pending?: boolean
  failed?: boolean
  /** Formatted previous synced value, struck through while pending. */
  previousDisplay?: string | null
  /** last_error of a failed cell, shown as the title. */
  error?: string | null
  onSave: (value: number | null) => Promise<unknown>
}

export const EditableCell = ({
  kind,
  value,
  display,
  label,
  readOnly,
  pending,
  failed,
  previousDisplay,
  error,
  onSave,
}: EditableCellProps) => {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  // Guards against blur firing after Enter/Esc or while a save is in flight.
  const settled = useRef(false)
  // The draft the server last rejected; blur must not resubmit it unchanged.
  const rejectedDraft = useRef<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const errorId = useId()

  const state = failed ? "failed" : pending ? "pending" : "idle"
  const tone =
    state === "failed"
      ? "bg-ui-tag-red-bg text-ui-tag-red-text"
      : state === "pending"
        ? "bg-ui-tag-orange-bg text-ui-tag-orange-text"
        : ""

  if (readOnly) {
    return (
      <span
        data-testid="editable-cell"
        data-state="readonly"
        className="text-ui-fg-subtle"
      >
        {display}
      </span>
    )
  }

  const start = () => {
    settled.current = false
    rejectedDraft.current = null
    setDraft(value === null || value === undefined ? "" : String(value))
    setMessage(null)
    setEditing(true)
  }

  const cancel = () => {
    settled.current = true
    setMessage(null)
    setEditing(false)
  }

  const commit = async () => {
    if (settled.current || saving) {
      return
    }
    if (rejectedDraft.current === draft) {
      return
    }
    const parsed = parse(kind, draft)
    if (!parsed.ok) {
      setMessage(
        t(
          kind === "price"
            ? "channelPricing.edit.invalidPrice"
            : "channelPricing.edit.invalidStock"
        )
      )
      return
    }
    if (parsed.value === value) {
      cancel()
      return
    }
    settled.current = true
    setSaving(true)
    setMessage(null)
    try {
      await onSave(parsed.value)
      setEditing(false)
    } catch (e) {
      settled.current = false
      rejectedDraft.current = draft
      setTimeout(() => inputRef.current?.focus(), 0)
      setMessage(
        e instanceof Error && e.message
          ? e.message
          : t("channelPricing.edit.saveFailed")
      )
    } finally {
      setSaving(false)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      void commit()
    } else if (e.key === "Escape") {
      e.preventDefault()
      cancel()
    }
  }

  if (editing) {
    return (
      <span
        data-testid="editable-cell"
        data-state="editing"
        className="inline-flex flex-col items-end gap-y-1"
      >
        <input
          ref={inputRef}
          autoFocus
          inputMode={kind === "price" ? "decimal" : "numeric"}
          aria-label={label}
          aria-invalid={message ? true : undefined}
          placeholder={
            kind === "price" ? t("channelPricing.edit.basePrice") : undefined
          }
          readOnly={saving}
          aria-describedby={message ? errorId : undefined}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            rejectedDraft.current = null
            setMessage(null)
          }}
          onKeyDown={onKeyDown}
          onBlur={() => void commit()}
          className="txt-compact-small h-7 w-24 rounded-md border-0 bg-ui-bg-field px-2 text-right text-ui-fg-base shadow-borders-base"
        />
        {saving && (
          <span className="text-xs text-ui-fg-muted" role="status">
            {t("channelPricing.edit.saving")}
          </span>
        )}
        {message && (
          <span
            id={errorId}
            role="alert"
            className="max-w-[16rem] text-xs text-ui-fg-error"
          >
            {message}
          </span>
        )}
      </span>
    )
  }

  return (
    <span
      data-testid="editable-cell"
      data-state={state}
      title={failed && error ? error : undefined}
      aria-describedby={failed && error ? errorId : undefined}
      className={`group relative inline-flex items-center gap-x-1 rounded px-1 ${tone}`}
    >
      {pending && previousDisplay && previousDisplay !== display ? (
        <span className="text-xs text-ui-fg-muted line-through">
          {previousDisplay}
        </span>
      ) : null}
      <span>{display}</span>
      {failed && error ? (
        <span id={errorId} className="sr-only">
          {error}
        </span>
      ) : null}
      <button
        type="button"
        aria-label={label}
        onClick={start}
        className="text-ui-fg-muted opacity-0 focus:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100"
      >
        <Pencil />
      </button>
    </span>
  )
}
