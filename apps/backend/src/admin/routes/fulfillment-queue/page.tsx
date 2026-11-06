import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Badge, Button, Container, Heading, Table, Text } from "@medusajs/ui"
import { sdk } from "../../lib/sdk"

type FulfillmentQueueOrder = {
  id: string
  display_id: number
  created_at: string
  email: string | null
  total: number
  currency_code: string
  fulfillment_status: "not_fulfilled" | "partially_fulfilled"
  sales_channel: { id: string; name: string } | null
  item_count: number
}

type FulfillmentQueueResponse = {
  orders: FulfillmentQueueOrder[]
  count: number
  offset: number
  limit: number
}

const LIMIT = 20

const FulfillmentQueuePage = () => {
  const [offset, setOffset] = useState(0)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin", "fulfillment-queue", offset],
    queryFn: () =>
      sdk.client.fetch<FulfillmentQueueResponse>("/admin/fulfillment-queue", {
        query: { offset, limit: LIMIT },
      }),
  })

  return (
    <Container>
      <Heading level="h1">Fulfillment Queue</Heading>

      {isLoading && <Text>Loading...</Text>}

      {isError && (
        <div>
          <Text>Something went wrong loading the fulfillment queue.</Text>
          <Button variant="secondary" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && data && data.orders.length === 0 && (
        <Text>No orders need fulfillment right now.</Text>
      )}

      {!isLoading && !isError && data && data.orders.length > 0 && (
        <>
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Order #</Table.HeaderCell>
                <Table.HeaderCell>Channel</Table.HeaderCell>
                <Table.HeaderCell>Date</Table.HeaderCell>
                <Table.HeaderCell>Customer</Table.HeaderCell>
                <Table.HeaderCell>Items</Table.HeaderCell>
                <Table.HeaderCell>Status</Table.HeaderCell>
                <Table.HeaderCell>Total</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {data.orders.map((order) => (
                <Table.Row key={order.id}>
                  <Table.Cell>
                    <a href={`/app/orders/${order.id}`}>#{order.display_id}</a>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge>{order.sales_channel?.name ?? "—"}</Badge>
                  </Table.Cell>
                  <Table.Cell>
                    {new Date(order.created_at).toLocaleDateString()}
                  </Table.Cell>
                  <Table.Cell>{order.email ?? "—"}</Table.Cell>
                  <Table.Cell>{order.item_count}</Table.Cell>
                  <Table.Cell>
                    <Badge>{order.fulfillment_status.replace(/_/g, " ")}</Badge>
                  </Table.Cell>
                  <Table.Cell>
                    {order.total} {order.currency_code.toUpperCase()}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>

          <div>
            <Button
              variant="secondary"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - LIMIT))}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              disabled={offset + LIMIT >= data.count}
              onClick={() => setOffset(offset + LIMIT)}
            >
              Next
            </Button>
          </div>
        </>
      )}
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Fulfillment Queue",
  nested: "/orders",
})

export default FulfillmentQueuePage
