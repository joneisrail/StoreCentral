import { Button, Prompt, Text, Textarea, toast } from "@medusajs/ui"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { useHoldOrder } from "../../../../../../hooks/api/order-holds"

const MAX_REASON_LENGTH = 255

type HoldOrderPromptProps = {
  order: { id: string; display_id?: number | null }
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Asks for a required reason, then puts the order on hold. */
export const HoldOrderPrompt = ({
  order,
  open,
  onOpenChange,
}: HoldOrderPromptProps) => {
  const { t } = useTranslation()
  const { mutateAsync: holdOrder } = useHoldOrder()
  const [reason, setReason] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submittingRef = useRef(false)

  const trimmed = reason.trim()
  const canSubmit =
    trimmed.length >= 1 && trimmed.length <= MAX_REASON_LENGTH && !isSubmitting

  const handleSubmit = async () => {
    if (!canSubmit || submittingRef.current) {
      return
    }

    submittingRef.current = true
    setIsSubmitting(true)

    try {
      await holdOrder({ id: order.id, reason: trimmed })
      toast.success(t("orders.rowActions.holdSuccess"))
      setReason("")
      onOpenChange(false)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      submittingRef.current = false
      setIsSubmitting(false)
    }
  }

  return (
    <Prompt
      open={open}
      onOpenChange={(next) => {
        if (isSubmitting) {
          return
        }
        if (!next) {
          setReason("")
        }
        onOpenChange(next)
      }}
    >
      <Prompt.Content>
        <Prompt.Header>
          <Prompt.Title>
            {t("orders.rowActions.holdTitle", { id: `#${order.display_id}` })}
          </Prompt.Title>
          <Prompt.Description>
            {t("orders.rowActions.holdDescription")}
          </Prompt.Description>
        </Prompt.Header>
        <div className="flex flex-col gap-y-1 px-6 pb-4">
          <Textarea
            aria-label={t("orders.rowActions.holdReason")}
            placeholder={t("orders.rowActions.holdReason")}
            value={reason}
            maxLength={MAX_REASON_LENGTH}
            onChange={(e) => setReason(e.target.value)}
          />
          <Text size="xsmall" className="self-end text-ui-fg-muted">
            {reason.length}/{MAX_REASON_LENGTH}
          </Text>
        </div>
        <Prompt.Footer>
          <Button
            size="small"
            variant="secondary"
            disabled={isSubmitting}
            onClick={() => {
              setReason("")
              onOpenChange(false)
            }}
          >
            {t("actions.cancel")}
          </Button>
          <Button
            size="small"
            disabled={!canSubmit}
            isLoading={isSubmitting}
            onClick={handleSubmit}
          >
            {t("orders.rowActions.holdConfirm")}
          </Button>
        </Prompt.Footer>
      </Prompt.Content>
    </Prompt>
  )
}
