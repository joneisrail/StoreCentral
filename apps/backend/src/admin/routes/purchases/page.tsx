import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  Badge,
  Button,
  Container,
  Heading,
  Table,
  Tabs,
  Text,
} from "@medusajs/ui"
import { Link, useNavigate } from "react-router-dom"
import { sdk } from "../../lib/sdk"
import { formatUsd, STATUS_LABELS } from "./format"
import type { AdminPurchase, PurchaseStatus } from "./types"

type PurchasesResponse = {
  purchases: AdminPurchase[]
  count: number
  offset: number
  limit: number
}

type StatusFilter = "all" | PurchaseStatus

const LIMIT = 20

const STATUS_TABS: { label: string; value: StatusFilter }[] = [
  { label: "All", value: "all" },
  { label: STATUS_LABELS.draft, value: "draft" },
  { label: STATUS_LABELS.ordered, value: "ordered" },
  { label: STATUS_LABELS.partially_received, value: "partially_received" },
  { label: STATUS_LABELS.received, value: "received" },
  { label: STATUS_LABELS.cancelled, value: "cancelled" },
]

const EMPTY_STATE_TEXT: Record<StatusFilter, string> = {
  all: "No purchases yet.",
  draft: "No draft purchases.",
  ordered: "No ordered purchases.",
  partially_received: "No partly received purchases.",
  received: "No received purchases.",
  cancelled: "No cancelled purchases.",
}

const PurchasesPage = () => {
  const [status, setStatus] = useState<StatusFilter>("all")
  const [offset, setOffset] = useState(0)
  const navigate = useNavigate()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin", "purchases", status, offset],
    queryFn: () => {
      const query: Record<string, unknown> = { limit: LIMIT, offset }
      if (status !== "all") {
        query.status = status
      }
      return sdk.client.fetch<PurchasesResponse>("/admin/purchases", { query })
    },
  })

  const handleTabChange = (value: string) => {
    setStatus(value as StatusFilter)
    setOffset(0)
  }

  return (
    <Container>
      <div className="flex items-center justify-between">
        <Heading level="h1">Purchases</Heading>
        <Button size="small" asChild>
          <Link to="/purchases/new">New purchase</Link>
        </Button>
      </div>

      <Tabs value={status} onValueChange={handleTabChange}>
        <Tabs.List>
          {STATUS_TABS.map((tab) => (
            <Tabs.Trigger key={tab.value} value={tab.value}>
              {tab.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
      </Tabs>

      {isLoading && <Text>Loading...</Text>}

      {isError && (
        <div>
          <Text>Something went wrong loading purchases.</Text>
          <Button size="small" variant="secondary" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && data && data.purchases.length === 0 && (
        <Text>{EMPTY_STATE_TEXT[status]}</Text>
      )}

      {!isLoading && !isError && data && data.purchases.length > 0 && (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Reference</Table.HeaderCell>
              <Table.HeaderCell>Supplier</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell>Total</Table.HeaderCell>
              <Table.HeaderCell>Ordered</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {data.purchases.map((purchase) => (
              <Table.Row
                key={purchase.id}
                className="cursor-pointer"
                onClick={() => navigate(`/purchases/${purchase.id}`)}
              >
                <Table.Cell>{purchase.reference}</Table.Cell>
                <Table.Cell>{purchase.supplier?.name ?? "—"}</Table.Cell>
                <Table.Cell>
                  <Badge>{STATUS_LABELS[purchase.status]}</Badge>
                </Table.Cell>
                <Table.Cell>{formatUsd(purchase.total)}</Table.Cell>
                <Table.Cell>
                  {purchase.ordered_at
                    ? new Date(purchase.ordered_at).toLocaleDateString()
                    : "—"}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}

      {!isLoading && !isError && data && (
        <div className="flex gap-2 pt-4">
          <Button
            size="small"
            variant="secondary"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - LIMIT))}
          >
            Previous
          </Button>
          <Button
            size="small"
            variant="secondary"
            disabled={offset + LIMIT >= data.count}
            onClick={() => setOffset(offset + LIMIT)}
          >
            Next
          </Button>
        </div>
      )}
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Purchases",
})

export default PurchasesPage
