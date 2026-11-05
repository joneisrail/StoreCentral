import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Badge,
  Button,
  Container,
  Heading,
  Table,
  Text,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { Link, useParams } from "react-router-dom"
import { sdk } from "../../../lib/sdk"
import { errorMessage, formatUsd, STATUS_LABELS } from "../format"
import { ReceiveGoodsDialog } from "../components/receive-goods-dialog"
import type { AdminPurchase } from "../types"

type PurchaseResponse = { purchase: AdminPurchase }

const SummaryRow = ({
  label,
  value,
  testId,
  strong,
}: {
  label: string
  value: string
  testId: string
  strong?: boolean
}) => (
  <div className="flex items-center justify-between">
    <Text size="small" weight={strong ? "plus" : "regular"}>
      {label}
    </Text>
    <Text size="small" weight={strong ? "plus" : "regular"} data-testid={testId}>
      {value}
    </Text>
  </div>
)

const PurchaseDetailPage = () => {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const prompt = usePrompt()
  const [actionError, setActionError] = useState<string | null>(null)

  const queryKey = ["admin", "purchases", "detail", id]

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey,
    queryFn: () => sdk.client.fetch<PurchaseResponse>(`/admin/purchases/${id}`),
  })

  const refresh = () => {
    // Covers both this purchase and every cached list page.
    queryClient.invalidateQueries({ queryKey: ["admin", "purchases"] })
  }

  const runAction = useMutation({
    mutationFn: (action: "order" | "cancel") =>
      sdk.client.fetch<PurchaseResponse>(`/admin/purchases/${id}/${action}`, {
        method: "POST",
      }),
    onMutate: () => setActionError(null),
    onSuccess: (_result, action) => {
      toast.success(action === "order" ? "Order placed" : "Purchase cancelled")
      refresh()
    },
    onError: (error: unknown) => {
      const message = errorMessage(error, "The action failed.")
      setActionError(message)
      toast.error(message)
    },
  })

  const handleCancel = async () => {
    const confirmed = await prompt({
      title: "Cancel purchase",
      description:
        "Are you sure you want to cancel this purchase? This cannot be undone.",
      confirmText: "Cancel purchase",
      cancelText: "Keep purchase",
    })
    if (confirmed) {
      runAction.mutate("cancel")
    }
  }

  if (isLoading) {
    return (
      <Container>
        <Text>Loading...</Text>
      </Container>
    )
  }

  if (isError || !data) {
    return (
      <Container>
        <Text>Something went wrong loading this purchase.</Text>
        <Button size="small" variant="secondary" onClick={() => refetch()}>
          Retry
        </Button>
      </Container>
    )
  }

  const { purchase } = data
  const itemTitles = new Map(purchase.items.map((item) => [item.id, item.title]))
  const canPlaceOrder = purchase.status === "draft"
  const canReceive =
    purchase.status === "ordered" || purchase.status === "partially_received"
  const canCancel = purchase.status === "draft" || purchase.status === "ordered"

  return (
    <div className="flex flex-col gap-4">
      <Container>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Heading level="h1">{purchase.reference}</Heading>
            <Badge data-testid="status">{STATUS_LABELS[purchase.status]}</Badge>
          </div>
          <div className="flex gap-2">
            {canPlaceOrder && (
              <Button
                size="small"
                isLoading={runAction.isPending}
                disabled={runAction.isPending}
                onClick={() => runAction.mutate("order")}
              >
                Place order
              </Button>
            )}
            {canReceive && (
              <ReceiveGoodsDialog purchase={purchase} onReceived={refresh} />
            )}
            {canCancel && (
              <Button
                size="small"
                variant="danger"
                disabled={runAction.isPending}
                onClick={handleCancel}
              >
                Cancel purchase
              </Button>
            )}
          </div>
        </div>
        {actionError && (
          <Text className="pt-2 text-ui-fg-error">{actionError}</Text>
        )}
        <div className="flex flex-col gap-1 pt-4">
          <Text size="small" className="text-ui-fg-subtle">
            Supplier:{" "}
            {purchase.supplier ? (
              <span>{purchase.supplier.name}</span>
            ) : (
              <span>—</span>
            )}
          </Text>
          {purchase.notes && (
            <Text size="small" className="text-ui-fg-subtle">
              {purchase.notes}
            </Text>
          )}
        </div>
      </Container>

      <Container>
        <Heading level="h2">Items</Heading>
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Product</Table.HeaderCell>
              <Table.HeaderCell>SKU</Table.HeaderCell>
              <Table.HeaderCell>Ordered</Table.HeaderCell>
              <Table.HeaderCell>Received</Table.HeaderCell>
              <Table.HeaderCell>Unit cost</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {purchase.items.map((item) => (
              <Table.Row key={item.id}>
                <Table.Cell>{item.title}</Table.Cell>
                <Table.Cell>{item.sku}</Table.Cell>
                <Table.Cell>{item.quantity}</Table.Cell>
                <Table.Cell>{item.quantity_received}</Table.Cell>
                <Table.Cell>{formatUsd(item.unit_cost)}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
        <div className="flex flex-col gap-1 pt-4">
          <SummaryRow
            label="Subtotal"
            value={formatUsd(purchase.subtotal)}
            testId="subtotal"
          />
          <SummaryRow
            label="Shipping"
            value={formatUsd(purchase.shipping_cost)}
            testId="shipping-cost"
          />
          <SummaryRow label="Tax" value={formatUsd(purchase.tax)} testId="tax" />
          <SummaryRow
            label="Other costs"
            value={formatUsd(purchase.other_cost)}
            testId="other-cost"
          />
          <SummaryRow
            label="Total"
            value={formatUsd(purchase.total)}
            testId="total"
            strong
          />
        </div>
      </Container>

      <Container>
        <Heading level="h2">Deliveries</Heading>
        {purchase.receipts.length === 0 && <Text>No deliveries yet.</Text>}
        {purchase.receipts.map((receipt) => (
          <div
            key={receipt.id}
            data-testid={`receipt-${receipt.id}`}
            className="flex flex-col gap-1 py-3"
          >
            <Text size="small" weight="plus">
              {new Date(receipt.received_at).toLocaleDateString()} · Location{" "}
              {receipt.stock_location_id}
            </Text>
            {receipt.items.map((line) => (
              <Text key={line.purchase_item_id} size="small">
                {itemTitles.get(line.purchase_item_id) ?? line.purchase_item_id}:{" "}
                {line.quantity}
              </Text>
            ))}
            {receipt.note && (
              <Text size="small" className="text-ui-fg-subtle">
                {receipt.note}
              </Text>
            )}
          </div>
        ))}
      </Container>

      <Link to="/purchases">
        <Text size="small">Back to purchases</Text>
      </Link>
    </div>
  )
}

export default PurchaseDetailPage
