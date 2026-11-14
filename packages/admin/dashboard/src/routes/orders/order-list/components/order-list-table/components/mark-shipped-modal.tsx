import { Button, FocusModal, Input, Label, Switch, toast } from "@medusajs/ui"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { useMarkOrderShipped } from "../../../../../../hooks/api/order-shipping"
import { buildTrackingUrl, CARRIER_SUGGESTIONS } from "./tracking-url"

type MarkShippedModalProps = {
  order: { id: string; display_id?: number | null }
  open: boolean
  onOpenChange: (open: boolean) => void
}

const todayValue = () => {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Records a shipment made outside the app (the user's own carrier and
 * tracking number), so the order leaves Ready to Ship.
 */
export const MarkShippedModal = ({
  order,
  open,
  onOpenChange,
}: MarkShippedModalProps) => {
  const { t } = useTranslation()
  const { mutateAsync: markShipped } = useMarkOrderShipped()
  const [initialDate] = useState(todayValue)
  const [carrier, setCarrier] = useState("")
  const [trackingNumber, setTrackingNumber] = useState("")
  const [trackingUrl, setTrackingUrl] = useState("")
  const [shipDate, setShipDate] = useState(initialDate)
  const [notify, setNotify] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submittingRef = useRef(false)

  const canSubmit =
    carrier.trim().length > 0 &&
    trackingNumber.trim().length > 0 &&
    !isSubmitting

  const reset = () => {
    setCarrier("")
    setTrackingNumber("")
    setTrackingUrl("")
    setShipDate(initialDate)
    setNotify(true)
  }

  const handleSubmit = async () => {
    if (!canSubmit || submittingRef.current) {
      return
    }

    submittingRef.current = true
    setIsSubmitting(true)

    const number = trackingNumber.trim()
    const url = trackingUrl.trim() || buildTrackingUrl(carrier, number)

    try {
      await markShipped({
        id: order.id,
        carrier: carrier.trim(),
        tracking_number: number,
        ...(url ? { tracking_url: url } : {}),
        ...(shipDate && shipDate !== initialDate
          ? { shipped_at: new Date(`${shipDate}T12:00:00`).toISOString() }
          : {}),
        ...(notify ? {} : { no_notification: true }),
      })
      toast.success(t("orders.shipping.markShippedSuccess"))
      reset()
      onOpenChange(false)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      submittingRef.current = false
      setIsSubmitting(false)
    }
  }

  return (
    <FocusModal
      open={open}
      onOpenChange={(next) => {
        if (isSubmitting) {
          return
        }
        if (!next) {
          reset()
        }
        onOpenChange(next)
      }}
    >
      <FocusModal.Content>
        <FocusModal.Header>
          <FocusModal.Title className="sr-only">
            {t("orders.shipping.markShippedTitle", {
              id: `#${order.display_id}`,
            })}
          </FocusModal.Title>
          <FocusModal.Description className="sr-only">
            {t("orders.shipping.markShippedDescription")}
          </FocusModal.Description>
          <Button
            size="small"
            isLoading={isSubmitting}
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {t("orders.shipping.markShippedConfirm")}
          </Button>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-col items-center overflow-y-auto p-16">
          <div className="flex w-full max-w-[480px] flex-col gap-y-4">
            <div className="flex flex-col gap-y-1">
              <Label htmlFor="ms-carrier">{t("orders.shipping.carrier")}</Label>
              <Input
                id="ms-carrier"
                list="ms-carrier-options"
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
              />
              <datalist id="ms-carrier-options">
                {CARRIER_SUGGESTIONS.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="flex flex-col gap-y-1">
              <Label htmlFor="ms-number">
                {t("orders.shipping.trackingNumber")}
              </Label>
              <Input
                id="ms-number"
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-y-1">
              <Label htmlFor="ms-url">{t("orders.shipping.trackingUrl")}</Label>
              <Input
                id="ms-url"
                value={trackingUrl}
                placeholder={t("orders.shipping.trackingUrlHint")}
                onChange={(e) => setTrackingUrl(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-y-1">
              <Label htmlFor="ms-date">{t("orders.shipping.shipDate")}</Label>
              <Input
                id="ms-date"
                type="date"
                value={shipDate}
                onChange={(e) => setShipDate(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-x-2">
              <Switch
                id="ms-notify"
                checked={notify}
                onCheckedChange={setNotify}
              />
              <Label htmlFor="ms-notify">
                {t("orders.shipping.emailCustomer")}
              </Label>
            </div>
          </div>
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  )
}
