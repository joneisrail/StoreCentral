import { Badge, Button, Heading, Table, Text, usePrompt } from "@medusajs/ui"
import { formatUsd } from "../../../../purchases/format"
import {
  formatInvoiceDate,
  paymentMethodLabel,
  paymentStatusColor,
  paymentStatusLabel,
} from "../../../format"
import type { AdminPayment } from "../../../types"

export const PaymentsSection = ({
  payments,
  disabled,
  onVoid,
}: {
  payments: AdminPayment[]
  // True while any other action on the invoice is pending.
  disabled: boolean
  onVoid: (payment: AdminPayment) => void
}) => {
  const prompt = usePrompt()

  const handleVoid = async (payment: AdminPayment) => {
    const confirmed = await prompt({
      title: "Void payment",
      description: `Void payment ${payment.reference}? The amount goes back onto the invoice balance.`,
      confirmText: "Void payment",
      cancelText: "Keep payment",
    })
    if (confirmed) {
      onVoid(payment)
    }
  }

  return (
    <div>
      <Heading level="h2">Payments</Heading>
      {payments.length === 0 ? (
        <Text size="small" className="pt-2 text-ui-fg-subtle">
          No payments recorded.
        </Text>
      ) : (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Date</Table.HeaderCell>
              <Table.HeaderCell>Method</Table.HeaderCell>
              <Table.HeaderCell>Reference</Table.HeaderCell>
              <Table.HeaderCell>Amount</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {payments.map((payment) => {
              const isVoid = payment.status === "void"
              return (
                <Table.Row
                  key={payment.id}
                  data-testid="payment-row"
                  className={isVoid ? "text-ui-fg-muted" : undefined}
                >
                  <Table.Cell>{formatInvoiceDate(payment.paid_at)}</Table.Cell>
                  <Table.Cell>{paymentMethodLabel(payment.method)}</Table.Cell>
                  <Table.Cell>{payment.payment_reference || "—"}</Table.Cell>
                  <Table.Cell>{formatUsd(payment.amount)}</Table.Cell>
                  <Table.Cell>
                    <Badge color={paymentStatusColor(payment.status)}>
                      {paymentStatusLabel(payment.status)}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>
                    {payment.status === "recorded" && (
                      <Button
                        size="small"
                        variant="danger"
                        disabled={disabled}
                        aria-label={`Void payment ${payment.reference}`}
                        onClick={() => handleVoid(payment)}
                      >
                        Void
                      </Button>
                    )}
                  </Table.Cell>
                </Table.Row>
              )
            })}
          </Table.Body>
        </Table>
      )}
    </div>
  )
}
