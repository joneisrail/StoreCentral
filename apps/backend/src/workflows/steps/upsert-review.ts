import {
  createStep,
  StepResponse,
} from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"
import { REVIEW_MODULE } from "../../modules/review"
import ReviewModuleService from "../../modules/review/service"

type Review = {
  id: string
  product_id: string
  customer_id: string
  order_id: string | null
  rating: number
  title: string
  comment: string
  status: "pending" | "approved" | "rejected"
  created_at: Date
  updated_at: Date
  deleted_at: Date | null
}

type ReviewInput = {
  product_id: string
  customer_id: string
  rating: number
  title: string
  comment: string
}

export function buildReviewUpsertInput(
  existing: { id: string } | null,
  input: ReviewInput,
  orderId: string
):
  | { mode: "create"; data: Record<string, unknown> }
  | { mode: "update"; id: string; data: Record<string, unknown> } {
  const data = {
    product_id: input.product_id,
    customer_id: input.customer_id,
    rating: input.rating,
    title: input.title,
    comment: input.comment,
    status: "pending",
    order_id: orderId,
  }

  return existing
    ? { mode: "update", id: existing.id, data }
    : { mode: "create", data }
}

// The (customer_id, product_id) unique index means a lost create-vs-create
// race surfaces here as a DB unique-constraint violation rather than a
// silent duplicate row. Medusa's mikro-orm error mapper turns that Postgres
// 23505 into a MedusaError(INVALID_DATA, "<Table> with <cols>, already
// exists.") before it reaches the module service, so that's the shape to
// detect -- not a raw Postgres error code.
export function isDuplicateReviewError(error: unknown): boolean {
  return (
    error != null &&
    MedusaError.isMedusaError(error) &&
    error.type === MedusaError.Types.INVALID_DATA &&
    /already exists/i.test(error.message)
  )
}

export const upsertReviewStep = createStep(
  "upsert-review",
  async (
    input: ReviewInput & { orderId: string },
    { container }
  ) => {
    const reviewModule = container.resolve<ReviewModuleService>(REVIEW_MODULE)

    const existingReviews: { id: string }[] = await reviewModule.listReviews({
      customer_id: input.customer_id,
      product_id: input.product_id,
    })

    const upsertInput = buildReviewUpsertInput(
      existingReviews[0] ?? null,
      input,
      input.orderId
    )

    let review: Review
    let wasCreated: boolean

    if (upsertInput.mode === "update") {
      review = await reviewModule.updateReviews({
        id: upsertInput.id,
        ...upsertInput.data,
      })
      wasCreated = false
    } else {
      try {
        review = await reviewModule.createReviews(upsertInput.data)
        wasCreated = true
      } catch (error) {
        if (!isDuplicateReviewError(error)) {
          throw error
        }

        // Lost the create-vs-create race: another request's createReviews
        // landed first. The row now exists -- re-fetch it and fall back to
        // updating it instead of letting the DB error bubble up as a 500.
        const [raceWinner]: { id: string }[] = await reviewModule.listReviews(
          {
            customer_id: input.customer_id,
            product_id: input.product_id,
          }
        )

        if (!raceWinner) {
          throw error
        }

        review = await reviewModule.updateReviews({
          id: raceWinner.id,
          ...upsertInput.data,
        })
        wasCreated = false
      }
    }

    return new StepResponse(
      { review, wasCreated },
      { reviewId: review.id, wasCreated }
    )
  },
  async (compensationInput, { container }) => {
    if (!compensationInput) {
      return
    }

    if (compensationInput.wasCreated) {
      const reviewModule = container.resolve<ReviewModuleService>(REVIEW_MODULE)
      await reviewModule.deleteReviews(compensationInput.reviewId)
    }
  }
)
