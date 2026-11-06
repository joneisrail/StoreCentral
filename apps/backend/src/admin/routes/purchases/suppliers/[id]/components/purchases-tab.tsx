import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Badge, Button, Container, Heading, Table, Text } from "@medusajs/ui"
import { Link } from "react-router-dom"
import { sdk } from "../../../../../lib/sdk"
import { formatUsd, STATUS_LABELS } from "../../../format"
import type { AdminPurchase, PurchaseStatus } from "../../../types"
import type { SupplierSummary } from "../../types"

type PurchasesResponse = {
  purchases: AdminPurchase[]
  count: number
  limit: number
  offset: number
}

const LIMIT = 20

const STATUSES = Object.keys(STATUS_LABELS) as PurchaseStatus[]

const labelFor = (status: string) =>
  (STATUS_LABELS as Record<string, string>)[status] ?? status

function Card({
  label,
  value,
  testId,
}: {
  label: string
  value: string
  testId: string
}) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col gap-1 rounded-md border border-ui-border-base p-3"
    >
      <Text size="small" className="text-ui-fg-subtle">
        {label}
      </Text>
      <Text weight="plus">{value}</Text>
    </div>
  )
}

export const PurchasesTab = ({ supplierId }: { supplierId: string }) => {
  const [offset, setOffset] = useState(0)

  const summaryQuery = useQuery({
    queryKey: ["admin", "suppliers", "summary", supplierId],
    queryFn: () =>
      sdk.client.fetch<{ summary: SupplierSummary }>(
        `/admin/suppliers/${supplierId}/summary`
      ),
  })

  const listQuery = useQuery({
    queryKey: ["admin", "suppliers", "purchases", supplierId, offset],
    queryFn: () =>
      sdk.client.fetch<PurchasesResponse>("/admin/purchases", {
        query: { supplier_id: supplierId, limit: LIMIT, offset },
      }),
  })

  const list = listQuery.data

  // If the list shrank so the current page is past the end, fall back to the
  // last page that still has rows.
  useEffect(() => {
    if (list && list.purchases.length === 0 && offset > 0) {
      setOffset(
        Math.max(0, Math.floor((Math.max(list.count, 1) - 1) / LIMIT) * LIMIT)
      )
    }
  }, [list, offset])

  const summary = summaryQuery.data?.summary

  return (
    <Container>
      <Heading level="h2">Purchases</Heading>

      {summaryQuery.isLoading && <Text>Loading...</Text>}

      {summaryQuery.isError && (
        <div>
          <Text>Something went wrong loading the summary.</Text>
          <Button
            size="small"
            variant="secondary"
            onClick={() => summaryQuery.refetch()}
          >
            Retry
          </Button>
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-2 gap-3 py-4 md:grid-cols-4">
          {[
            ...STATUSES,
            ...Object.keys(summary.counts).filter((k) => !(k in STATUS_LABELS)),
          ].map((status) => (
            <Card
              key={status}
              testId={`count-${status}`}
              label={labelFor(status)}
              value={String(summary.counts[status] ?? 0)}
            />
          ))}
          <Card
            testId="total-ordered"
            label="Total ordered"
            value={formatUsd(summary.total_ordered)}
          />
          <Card
            testId="total-received"
            label="Total received"
            value={formatUsd(summary.total_received)}
          />
          <Card
            testId="total-outstanding"
            label="Outstanding"
            value={formatUsd(summary.outstanding)}
          />
        </div>
      )}

      {listQuery.isLoading && <Text>Loading...</Text>}

      {listQuery.isError && (
        <div>
          <Text>Something went wrong loading purchases.</Text>
          <Button
            size="small"
            variant="secondary"
            onClick={() => listQuery.refetch()}
          >
            Retry
          </Button>
        </div>
      )}

      {list && list.purchases.length === 0 && offset === 0 && (
        <Text>No purchases yet.</Text>
      )}

      {list && list.purchases.length > 0 && (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Reference</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell>Total</Table.HeaderCell>
              <Table.HeaderCell>Ordered</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {list.purchases.map((purchase) => (
              <Table.Row key={purchase.id}>
                <Table.Cell>
                  <Link to={`/purchases/${purchase.id}`}>
                    {purchase.reference}
                  </Link>
                </Table.Cell>
                <Table.Cell>
                  <Badge>{labelFor(purchase.status)}</Badge>
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

      {list && (
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
            disabled={offset + LIMIT >= list.count}
            onClick={() => setOffset(offset + LIMIT)}
          >
            Next
          </Button>
        </div>
      )}
    </Container>
  )
}
