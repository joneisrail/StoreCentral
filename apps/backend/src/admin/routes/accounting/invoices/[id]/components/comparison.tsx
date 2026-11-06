import { Badge, Heading, Table, Text } from "@medusajs/ui"
import { formatUsd } from "../../../../purchases/format"
import type { InvoiceComparison } from "../../../types"

const money = (value: number | null) => (value === null ? "—" : formatUsd(value))

export const Comparison = ({
  comparison,
}: {
  comparison: InvoiceComparison | null
}) => {
  if (!comparison) {
    return (
      <div className="flex flex-col gap-2">
        <Heading level="h2">Comparison with purchase</Heading>
        <Text>No comparison available.</Text>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <Heading level="h2">Comparison with purchase</Heading>
      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Item</Table.HeaderCell>
            <Table.HeaderCell>Ordered</Table.HeaderCell>
            <Table.HeaderCell>Received</Table.HeaderCell>
            <Table.HeaderCell>Invoiced</Table.HeaderCell>
            <Table.HeaderCell>Invoiced (all invoices)</Table.HeaderCell>
            <Table.HeaderCell>Ordered cost</Table.HeaderCell>
            <Table.HeaderCell>Invoiced cost</Table.HeaderCell>
            <Table.HeaderCell>Warnings</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {comparison.items.map((item, index) => (
            <Table.Row
              key={`${item.purchase_item_id ?? item.variant_id}-${index}`}
              data-testid="comparison-row"
            >
              <Table.Cell>{item.title}</Table.Cell>
              <Table.Cell>{item.ordered_quantity}</Table.Cell>
              <Table.Cell>{item.received_quantity}</Table.Cell>
              <Table.Cell>{item.invoiced_quantity}</Table.Cell>
              <Table.Cell>{item.invoiced_quantity_total}</Table.Cell>
              <Table.Cell>{money(item.ordered_unit_cost)}</Table.Cell>
              <Table.Cell>{money(item.invoiced_unit_cost)}</Table.Cell>
              <Table.Cell>
                <div className="flex flex-wrap gap-1">
                  {item.flags.price_difference && (
                    <Badge size="2xsmall" color="orange">
                      Price difference
                    </Badge>
                  )}
                  {item.flags.over_received && (
                    <Badge size="2xsmall" color="orange">
                      Billed above received
                    </Badge>
                  )}
                  {item.flags.over_ordered && (
                    <Badge size="2xsmall" color="orange">
                      Billed above ordered
                    </Badge>
                  )}
                  {item.flags.not_on_purchase && (
                    <Badge size="2xsmall" color="orange">
                      Not on purchase
                    </Badge>
                  )}
                </div>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
      <div className="flex flex-col gap-1 pt-2">
        <Text>
          Purchase total:{" "}
          <span data-testid="purchase-total">
            {formatUsd(comparison.purchase_total)}
          </span>
        </Text>
        <Text>
          Invoice total:{" "}
          <span data-testid="comparison-invoice-total">
            {formatUsd(comparison.invoice_total)}
          </span>
        </Text>
        <Text weight="plus">
          Difference:{" "}
          <span data-testid="comparison-difference">
            {formatUsd(comparison.difference)}
          </span>
        </Text>
      </div>
    </div>
  )
}
