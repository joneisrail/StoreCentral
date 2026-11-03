import { Alert, Button, Text } from "@medusajs/ui"
import { useTranslation } from "react-i18next"

import { BulkFulfillOrdersResult } from "../../../../../../hooks/api/orders"

/**
 * Shown under a failed order whose label was already bought before its
 * fulfillment failed to be recorded (`easypost_shipment_id` on the failure
 * entry), so the purchase is recoverable rather than silently orphaned:
 * the admin gets the exact EasyPost shipment id to resolve it with. Shared
 * by this summary and `FulfillConfirmPopover`'s single-row error display.
 */
export const OrphanedLabelNotice = ({ shipmentId }: { shipmentId: string }) => {
  const { t } = useTranslation()

  return (
    <Text size="small" weight="plus" className="text-ui-fg-error">
      {t("orders.readyToShip.orphanedLabel", { shipmentId })}
    </Text>
  )
}

type BulkFulfillResultSummaryProps = {
  result: BulkFulfillOrdersResult
  onDismiss: () => void
}

/**
 * Renders the structured, per-order outcome of a bulk Fulfill action, per
 * the design spec's Error handling section: a "<succeeded> fulfilled,
 * <failed> failed" count, plus - when there are failures - each failed
 * order's own id and error message. A single generic toast would collapse
 * which orders failed and why into one undifferentiated message, so this
 * is rendered inline instead and stays on screen until dismissed.
 *
 * Dismissal is owned by the caller (`onDismiss` clears the result from
 * `ReadyToShipTable`'s own state) rather than `Alert`'s own `dismissible`
 * prop, since that prop only toggles the alert's internal visibility - it
 * wouldn't let a later bulk action's result replace this one reliably.
 *
 * When the batch's response includes `label_pdf_url` (the labels of every
 * successfully FULFILLED order combined into one PDF by the provider - a
 * label bought for an order whose fulfillment then failed is deliberately
 * left out, so it can't be printed and shipped by mistake), a "Print N
 * labels" link to it is rendered too, N being exactly the succeeded count
 * that PDF contains - absent for a batch where every fulfillment failed, or
 * whenever the provider doesn't support combining labels this way. A failed
 * order whose label was already bought shows `OrphanedLabelNotice` with the
 * bought shipment's id.
 */
export const BulkFulfillResultSummary = ({
  result,
  onDismiss,
}: BulkFulfillResultSummaryProps) => {
  const { t } = useTranslation()
  const { succeeded, failed, label_pdf_url } = result
  const hasFailures = failed.length > 0

  return (
    <div className="px-6 py-4">
      <Alert
        variant={hasFailures ? "warning" : "success"}
        dismissible={false}
        className="flex flex-col gap-y-3"
      >
        <div className="flex items-center justify-between gap-x-4">
          <Text size="small" weight="plus">
            {t("orders.readyToShip.bulkFulfillSummary", {
              succeeded: succeeded.length,
              failed: failed.length,
            })}
          </Text>
          <Button size="small" variant="transparent" onClick={onDismiss}>
            {t("actions.close")}
          </Button>
        </div>
        {label_pdf_url && (
          <a
            href={label_pdf_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover transition-fg underline"
          >
            <Text size="small" as="span">
              {`Print ${succeeded.length} label${
                succeeded.length === 1 ? "" : "s"
              }`}
            </Text>
          </a>
        )}
        {hasFailures && (
          <div className="flex flex-col gap-y-2">
            {failed.map((failure) => (
              <div key={failure.order_id} className="flex flex-col gap-y-0.5">
                <Text size="small" className="text-ui-fg-subtle">
                  {failure.order_id}: {failure.error}
                </Text>
                {failure.easypost_shipment_id && (
                  <OrphanedLabelNotice
                    shipmentId={failure.easypost_shipment_id}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </Alert>
    </div>
  )
}
