import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { ORDER_EVENTS_MODULE } from "../../../../../modules/order-events"
import type { OrderEventRecord } from "../../../../../modules/order-events"

type EventActor = "system" | { id: string; name: string | null }

const displayName = (user: any): string | null => {
  const full = [user?.first_name, user?.last_name]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter(Boolean)
    .join(" ")
  if (full) return full
  const local = typeof user?.email === "string" ? user.email.split("@")[0] : ""
  return local || null
}

// Change history of one order, newest first (up to 200). Actor names are
// resolved with one batched user lookup. /admin routes are authenticated by
// the framework's default middleware.
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const orderId = req.params.id
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: ["id"],
    filters: { id: orderId },
  })
  if (!data?.length) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order ${orderId} was not found`)
  }

  const service = req.scope.resolve(ORDER_EVENTS_MODULE) as {
    listForOrder: (id: string, limit?: number) => Promise<OrderEventRecord[]>
  }
  const rows = await service.listForOrder(orderId, 200)

  const userIds = [...new Set(rows.map((r) => r.actor).filter((a) => a !== "system" && a !== "unknown"))]
  const names = new Map<string, string | null>()
  if (userIds.length) {
    const users = req.scope.resolve(Modules.USER) as {
      listUsers: (filters: Record<string, unknown>, config?: Record<string, unknown>) => Promise<any[]>
    }
    for (const u of await users.listUsers({ id: userIds }, { select: ["id", "first_name", "last_name", "email"] })) {
      names.set(u.id, displayName(u))
    }
  }

  const events = rows.map((r) => {
    const actor: EventActor =
      r.actor === "system" ? "system" : { id: r.actor, name: names.get(r.actor) ?? null }
    return {
      id: r.id,
      type: r.type,
      actor,
      old_value: r.old_value ?? null,
      new_value: r.new_value ?? null,
      created_at: r.created_at,
    }
  })
  res.json({ events })
}
