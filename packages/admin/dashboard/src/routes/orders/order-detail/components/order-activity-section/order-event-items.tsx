import { Text } from "@medusajs/ui"
import { ReactNode } from "react"
import type { TFunction } from "i18next"

import { By } from "../../../../../components/common/user-link"
import type { OrderEvent } from "../../../../../hooks/api/order-events"

export type EventActivity = {
  title: ReactNode
  timestamp: string
  children?: ReactNode
}

const asRecord = (value: unknown): Record<string, unknown> => {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {}
}

const asString = (value: unknown): string | null => {
  return typeof value === "string" && value.trim() ? value : null
}

const getTitle = (type: string, t: TFunction): string | null => {
  switch (type) {
    case "order.held":
      return t("orders.activity.events.order.held")
    case "order.released":
      return t("orders.activity.events.order.released")
    case "order.label_voided":
      return t("orders.activity.events.order.label_voided")
    case "order.marked_shipped":
      return t("orders.activity.events.order.marked_shipped")
    case "order.canceled":
      return t("orders.activity.events.order.canceled")
    case "order.shipped":
      return t("orders.activity.events.order.shipped")
    case "order.delivered":
      return t("orders.activity.events.order.delivered")
    default:
      return null
  }
}

const renderActor = (actor: OrderEvent["actor"], t: TFunction): ReactNode => {
  if (actor === "system") {
    return t("orders.activity.events.order.actor.system")
  }

  if (actor?.name) {
    return actor.name
  }

  if (actor?.id && actor.id !== "unknown") {
    return <By id={actor.id} />
  }

  return t("orders.activity.events.order.actor.unknown")
}

const getDetail = (event: OrderEvent, t: TFunction): string | null => {
  const oldValue = asRecord(event.old_value)
  const newValue = asRecord(event.new_value)

  switch (event.type) {
    case "order.held": {
      const reason = asString(newValue.reason)
      return reason
        ? t("orders.activity.events.order.reason", { reason })
        : null
    }
    case "order.released": {
      const reason = asString(oldValue.reason)
      return reason
        ? t("orders.activity.events.order.previousReason", { reason })
        : null
    }
    case "order.label_voided": {
      const ids = newValue.fulfillment_ids
      return Array.isArray(ids)
        ? t("orders.activity.events.order.labelsVoided", { count: ids.length })
        : null
    }
    case "order.marked_shipped": {
      const carrier = asString(newValue.carrier)
      const tracking = asString(newValue.tracking_number)
      const parts = [
        carrier ? t("orders.activity.events.order.via", { carrier }) : null,
        tracking,
      ].filter(Boolean)
      return parts.length ? parts.join(" · ") : null
    }
    default:
      return null
  }
}

/**
 * Maps an order event to a timeline item. All dynamic values are rendered as
 * React text (escaped), never as HTML.
 */
export const eventToActivityItem = (
  event: OrderEvent,
  t: TFunction
): EventActivity | null => {
  const title = getTitle(event.type, t)

  if (!title) {
    return null
  }

  const detail = getDetail(event, t)

  return {
    title,
    timestamp: event.created_at,
    children: (
      <div className="flex flex-col gap-y-1 text-ui-fg-subtle">
        {detail && <Text size="small">{detail}</Text>}
        <div className="flex items-center gap-x-2 text-sm">
          {renderActor(event.actor, t)}
        </div>
      </div>
    ),
  }
}

export const eventsToActivityItems = (
  events: OrderEvent[],
  t: TFunction
): EventActivity[] =>
  events
    .map((event) => eventToActivityItem(event, t))
    .filter((item): item is EventActivity => !!item)
