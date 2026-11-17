import { Button, Container, Heading, Text } from "@medusajs/ui"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router-dom"

import {
  ChannelOfferCell,
  ChannelOfferChannel,
  useChannelOffers,
  useSyncChannelOffer,
  useUpdateChannelOffer,
} from "../../../../hooks/api/channel-offers"
import { EditableCell } from "./editable-cell"
import { SyncButton } from "./sync-button"

const PAGE_SIZE = 50
const SEARCH_DEBOUNCE_MS = 300
const DEFAULT_ORDER = "total"

const formatAmount = (value: number | null | undefined) => {
  if (value === null || value === undefined) {
    return "-"
  }
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

const STATIC_ORDER = /^-?(name|total|unallocated)$/
const CHANNEL_ORDER = /^-?([A-Za-z0-9_]+):(stock|price)$/

const isKnownOrder = (order: string, channelIds: Set<string>) => {
  if (STATIC_ORDER.test(order)) {
    return true
  }
  const match = CHANNEL_ORDER.exec(order)
  return !!match && channelIds.has(match[1])
}

const selectClass =
  "bg-ui-bg-field text-ui-fg-base txt-compact-small shadow-borders-base h-8 rounded-md border-0 px-2"

type CellKind = "price" | "stock"
type OfferKey = `${string}:${string}:${CellKind}`
type SaveFn = (
  variantId: string,
  channel: ChannelOfferChannel,
  cell: ChannelOfferCell,
  kind: CellKind,
  value: number | null
) => Promise<unknown>

// Only a marketplace with a connection is ever synced by Seller Hub; the
// offers of web, POS, other and unconnected channels default to "pending" and
// nothing flips them, so they must never look pending or failed.
const isPending = (cell: ChannelOfferCell) =>
  cell.has_connection && cell.sync_state === "pending"
const isFailed = (cell: ChannelOfferCell) =>
  cell.has_connection && cell.sync_state === "failed"

const MAX_SEARCH_LENGTH = 100

const OfferCell = ({
  variantId,
  channel,
  cell,
  kind,
  previous,
  onSave,
}: {
  variantId: string
  channel: ChannelOfferChannel
  cell: ChannelOfferCell | undefined
  kind: CellKind
  previous: Record<string, number | null>
  onSave: SaveFn
}) => {
  const { t } = useTranslation()

  if (!cell) {
    return <span className="text-ui-fg-muted">-</span>
  }

  // Web and POS channels always sell at the base price (their stock stays
  // editable); marketplaces fall back to it when they have no price of their
  // own.
  const readOnly =
    kind === "price" && (channel.kind === "web" || channel.kind === "pos")
  const isFallback =
    kind === "price" && cell.price === null && cell.effective_price !== null
  const shown = kind === "price" ? cell.effective_price : cell.stock
  const format = (v: number | null | undefined) => {
    return kind === "price" ? formatAmount(v) : String(v ?? "-")
  }
  const key: OfferKey = `${variantId}:${channel.id}:${kind}`
  const hasPrevious = key in previous

  return (
    <span
      className="inline-flex items-center gap-x-1"
      title={isFallback ? t("channelPricing.basePriceHint") : undefined}
    >
      <EditableCell
        kind={kind}
        value={kind === "price" ? cell.price : cell.stock}
        display={format(shown)}
        label={t(`channelPricing.edit.${kind}`, { channel: channel.name })}
        readOnly={readOnly}
        pending={isPending(cell)}
        failed={isFailed(cell)}
        error={cell.last_error}
        previousDisplay={hasPrevious ? format(previous[key]) : null}
        onSave={(value) => onSave(variantId, channel, cell, kind, value)}
      />
      {isFallback && (
        <span data-testid="price-fallback" className="text-xs text-ui-fg-muted">
          {t("channelPricing.baseMarker")}
        </span>
      )}
    </span>
  )
}

export const ChannelGrid = () => {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()

  const rawQ = params.get("q") ?? ""
  const q = rawQ.trim().slice(0, MAX_SEARCH_LENGTH)
  const urlOrder = params.get("order") || DEFAULT_ORDER
  const rawOffset = params.get("offset")
  const parsedOffset = Number(rawOffset)
  const offset =
    rawOffset !== null && Number.isFinite(parsedOffset)
      ? Math.max(0, Math.floor(parsedOffset))
      : 0
  // The URL carried something that had to be cleaned before being sent.
  const paramsInvalid =
    (rawQ !== "" && rawQ !== q) ||
    (rawOffset !== null && rawOffset !== "" && String(offset) !== rawOffset)
  const channelsParam = params.get("channels")

  const [searchText, setSearchText] = useState(q)
  // Channel ids from the last good response, used to validate the URL order.
  const [knownChannelIds, setKnownChannelIds] = useState<Set<string>>(
    () => new Set()
  )
  const orderIsValid = isKnownOrder(urlOrder, knownChannelIds)
  const order = orderIsValid ? urlOrder : DEFAULT_ORDER

  // The URL holds the trimmed term; only take it over when it differs from
  // what is typed, or a trailing space would be wiped while typing.
  useEffect(() => {
    setSearchText((current) => {
      return current.trim() === q ? current : q
    })
  }, [q])

  const update = (changes: Record<string, string | null>) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === "") {
            next.delete(key)
          } else {
            next.set(key, value)
          }
        }
        return next
      },
      { replace: true }
    )
  }

  useEffect(() => {
    if (searchText.trim() === q) {
      return
    }
    const handle = setTimeout(() => {
      update({ q: searchText.trim() || null, offset: null })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText, q])

  const updateOffer = useUpdateChannelOffer()
  const syncOffer = useSyncChannelOffer()
  // Previous synced values, kept client-side so a pending cell can show what
  // the marketplace still has. Overwritten on the first edit of a synced cell.
  const [previous, setPrevious] = useState<Record<string, number | null>>({})

  const save: SaveFn = async (variantId, channel, cell, kind, value) => {
    const key = `${variantId}:${channel.id}:${kind}`
    const old = kind === "price" ? cell.effective_price : cell.stock
    await updateOffer.mutateAsync({
      variant_id: variantId,
      channel_id: channel.id,
      body: kind === "price" ? { price: value } : { stock: value as number },
    })
    if (cell.has_connection) {
      setPrevious((prev) => {
        // Only a synced cell has a trustworthy previous value; a cell that
        // loaded already pending keeps amber without a strikethrough.
        if (cell.sync_state !== "synced") {
          return prev
        }
        return { ...prev, [key]: old }
      })
    }
  }

  const { data, isLoading, isError, refetch } = useChannelOffers({
    q: q || undefined,
    order,
    limit: PAGE_SIZE,
    offset,
  })

  // Drop remembered previous values once a cell is synced again, so a later
  // pending change that was not made here never shows a stale strikethrough.
  useEffect(() => {
    if (!data) {
      return
    }
    setPrevious((prev) => {
      const next = { ...prev }
      let changed = false
      for (const key of Object.keys(prev)) {
        const [variantId, channelId] = key.split(":")
        const row = data.rows.find((r) => r.variant_id === variantId)
        if (row?.channels[channelId]?.sync_state === "synced") {
          delete next[key]
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [data])

  const allChannels = data?.channels ?? []
  const loadedChannels = data?.channels
  useEffect(() => {
    if (loadedChannels) {
      setKnownChannelIds(new Set(loadedChannels.map((c) => c.id)))
    }
  }, [loadedChannels])
  const sortWasReset =
    !!loadedChannels &&
    knownChannelIds.size > 0 &&
    !isKnownOrder(urlOrder, knownChannelIds)
  const visibleIds = useMemo(() => {
    if (channelsParam === null) {
      return null
    }
    return new Set(channelsParam.split(","))
  }, [channelsParam])
  const channels = allChannels.filter(
    (c) => !visibleIds || visibleIds.has(c.id)
  )

  const toggleChannel = (id: string) => {
    const current = allChannels
      .filter((c) => !visibleIds || visibleIds.has(c.id))
      .map((c) => c.id)
    const next = current.includes(id)
      ? current.filter((x) => x !== id)
      : allChannels
          .map((c) => c.id)
          .filter((x) => x === id || current.includes(x))
    update({
      channels:
        next.length === allChannels.length ? null : next.join(",") || "none",
    })
  }

  const descending = order.startsWith("-")
  const sortKey = descending ? order.slice(1) : order

  const setSort = (key: string, desc: boolean) =>
    update({
      order: key === DEFAULT_ORDER && !desc ? null : `${desc ? "-" : ""}${key}`,
      offset: null,
    })

  const sortOptions = [
    { value: "name", label: t("channelPricing.sort.name") },
    { value: "total", label: t("channelPricing.sort.total") },
    { value: "unallocated", label: t("channelPricing.sort.unallocated") },
    ...allChannels.flatMap((c) => [
      {
        value: `${c.id}:stock`,
        label: t("channelPricing.sort.channelStock", { channel: c.name }),
      },
      {
        value: `${c.id}:price`,
        label: t("channelPricing.sort.channelPrice", { channel: c.name }),
      },
    ]),
  ]

  const rows = data?.rows ?? []
  const count = data?.count ?? 0

  useEffect(() => {
    if (data && !isError && rows.length === 0 && offset > 0) {
      const last =
        count > 0 ? Math.floor((count - 1) / PAGE_SIZE) * PAGE_SIZE : 0
      update({ offset: last > 0 ? String(last) : null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, isError, offset, count, rows.length])

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-y-3 px-6 py-4">
        <Heading level="h1">{t("channelPricing.title")}</Heading>
        <div className="flex flex-wrap items-end gap-3">
          <input
            type="search"
            role="searchbox"
            aria-label={t("channelPricing.search")}
            placeholder={t("channelPricing.search")}
            maxLength={100}
            className={`${selectClass} w-64`}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
          <label className="txt-compact-small flex flex-col gap-y-1">
            <span className="text-ui-fg-subtle">
              {t("channelPricing.sortBy")}
            </span>
            <select
              className={selectClass}
              value={sortKey}
              onChange={(e) => setSort(e.target.value, descending)}
            >
              {sortOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="txt-compact-small flex flex-col gap-y-1">
            <span className="text-ui-fg-subtle">
              {t("channelPricing.direction")}
            </span>
            <select
              className={selectClass}
              value={descending ? "desc" : "asc"}
              onChange={(e) => setSort(sortKey, e.target.value === "desc")}
            >
              <option value="asc">{t("channelPricing.lowToHigh")}</option>
              <option value="desc">{t("channelPricing.highToLow")}</option>
            </select>
          </label>
        </div>
        {allChannels.length > 0 && (
          <div
            className="flex flex-wrap items-center gap-2"
            role="group"
            aria-label={t("channelPricing.channels")}
          >
            {allChannels.map((c) => {
              const on = !visibleIds || visibleIds.has(c.id)
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleChannel(c.id)}
                  className={`txt-compact-small-plus rounded-full border px-3 py-1 ${
                    on
                      ? "border-ui-border-interactive bg-ui-bg-interactive text-ui-fg-on-color"
                      : "border-ui-border-base text-ui-fg-subtle"
                  }`}
                >
                  {c.name}
                </button>
              )
            })}
          </div>
        )}
        {sortWasReset && (
          <Text size="small" className="text-ui-fg-subtle" role="status">
            {t("channelPricing.sortReset")}
          </Text>
        )}
        {data?.truncated && (
          <Text size="small" className="text-ui-fg-subtle" role="status">
            {t("channelPricing.truncated")}
          </Text>
        )}
      </div>

      {isError ? (
        <div className="flex flex-col items-center gap-y-3 px-6 py-12">
          <Text className="text-ui-fg-subtle">{t("channelPricing.error")}</Text>
          <div className="flex items-center gap-x-2">
            <Button size="small" variant="secondary" onClick={() => refetch()}>
              {t("actions.retry")}
            </Button>
            {(params.get("order") || paramsInvalid) && (
              <Button
                size="small"
                variant="secondary"
                onClick={() => update({ q: null, order: null, offset: null })}
              >
                {paramsInvalid
                  ? t("channelPricing.resetFilters")
                  : t("channelPricing.resetSort")}
              </Button>
            )}
          </div>
        </div>
      ) : isLoading ? (
        <div className="px-6 py-12">
          <Text className="text-ui-fg-subtle">
            {t("channelPricing.loading")}
          </Text>
        </div>
      ) : rows.length === 0 ? (
        <div className="px-6 py-12">
          <Text className="text-ui-fg-subtle">{t("channelPricing.empty")}</Text>
        </div>
      ) : (
        <div className="overflow-x-auto" tabIndex={0}>
          <table className="txt-compact-small w-full border-collapse">
            <thead className="bg-ui-bg-subtle text-ui-fg-subtle">
              <tr>
                <th
                  rowSpan={2}
                  scope="col"
                  className="sticky left-0 z-10 min-w-[220px] bg-ui-bg-subtle px-4 py-2 text-left"
                >
                  {t("channelPricing.product")}
                </th>
                {channels.map((c) => (
                  <th
                    key={c.id}
                    colSpan={2}
                    scope="colgroup"
                    data-channel-group=""
                    className="border-l border-ui-border-base px-4 py-2 text-center"
                  >
                    {c.name}
                  </th>
                ))}
                <th
                  rowSpan={2}
                  scope="col"
                  className="border-l border-ui-border-base px-4 py-2 text-right"
                >
                  {t("channelPricing.total")}
                </th>
                <th rowSpan={2} scope="col" className="px-4 py-2 text-right">
                  {t("channelPricing.unallocated")}
                </th>
              </tr>
              <tr>
                {channels.flatMap((c) => [
                  <th
                    key={`${c.id}-price`}
                    scope="col"
                    className="border-l border-ui-border-base px-4 py-1 text-right font-normal"
                  >
                    {t("channelPricing.price")}
                  </th>,
                  <th
                    key={`${c.id}-stock`}
                    scope="col"
                    className="px-4 py-1 text-right font-normal"
                  >
                    {t("channelPricing.stock")}
                  </th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.variant_id}
                  className="border-t border-ui-border-base"
                >
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-ui-bg-base px-4 py-2 text-left font-normal"
                  >
                    <div className="text-ui-fg-base">{row.product_title}</div>
                    <div className="text-xs text-ui-fg-subtle">
                      {[row.variant_title, row.sku].filter(Boolean).join(" · ")}
                    </div>
                  </th>
                  {channels.flatMap((c) => {
                    const cell = row.channels[c.id]
                    return [
                      <td
                        key={`${c.id}-price`}
                        className="border-l border-ui-border-base px-4 py-2 text-right"
                      >
                        <span className="inline-flex items-center gap-x-2">
                          <OfferCell
                            variantId={row.variant_id}
                            channel={c}
                            cell={cell}
                            kind="price"
                            previous={previous}
                            onSave={save}
                          />
                          {cell && (
                            <SyncButton
                              channelName={c.name}
                              live={c.kind === "web" || c.kind === "pos"}
                              hasConnection={cell.has_connection}
                              error={cell.last_error}
                              state={cell.sync_state}
                              onSync={() =>
                                syncOffer.mutateAsync({
                                  variant_id: row.variant_id,
                                  channel_id: c.id,
                                })
                              }
                            />
                          )}
                        </span>
                      </td>,
                      <td
                        key={`${c.id}-stock`}
                        className="px-4 py-2 text-right"
                      >
                        <OfferCell
                          variantId={row.variant_id}
                          channel={c}
                          cell={cell}
                          kind="stock"
                          previous={previous}
                          onSave={save}
                        />
                      </td>,
                    ]
                  })}
                  <td className="border-l border-ui-border-base px-4 py-2 text-right">
                    {row.available}
                  </td>
                  <td className="px-4 py-2 text-right">{row.unallocated}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isError && !isLoading && rows.length > 0 && (
        <div className="flex items-center justify-between px-6 py-3">
          <Text size="small" className="text-ui-fg-subtle">
            {t("channelPricing.showing", {
              shown: rows.length,
              count,
            })}
          </Text>
          <div className="flex items-center gap-x-2">
            <Button
              size="small"
              variant="secondary"
              disabled={offset === 0}
              onClick={() =>
                update({
                  offset:
                    offset - PAGE_SIZE <= 0 ? null : String(offset - PAGE_SIZE),
                })
              }
            >
              {t("general.prev")}
            </Button>
            <Button
              size="small"
              variant="secondary"
              disabled={offset + PAGE_SIZE >= count}
              onClick={() => update({ offset: String(offset + PAGE_SIZE) })}
            >
              {t("general.next")}
            </Button>
          </div>
        </div>
      )}
    </Container>
  )
}
