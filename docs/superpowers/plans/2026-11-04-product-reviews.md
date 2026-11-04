# Product Reviews (Backend + Admin Moderation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authenticated customer submit a star rating + title + comment review for a product they've bought, and let admin users moderate (approve/reject) those reviews from a new dashboard page, before any review is exposed publicly.

**Architecture:** A new `review` Medusa module (data model + service) holds reviews, linked to the core Product and Customer modules. Three workflows (`upsertReviewWorkflow`, `deleteReviewWorkflow`, `updateReviewStatusWorkflow`) carry all business logic. Five API routes (store POST/DELETE, admin GET/approve/reject) call those workflows. A new admin UI page lists and moderates reviews, mirroring the existing Fulfillment Queue page's shape.

**Tech Stack:** Medusa v2 (modules, workflows, DML), Zod v4 for request validation, Jest (`test:unit`, `test:integration:modules`, `test:integration:http`), React + `@tanstack/react-query` + Medusa UI for the admin page, Vitest for the admin page's unit spec.

**Spec:** `docs/superpowers/specs/2026-11-04-product-reviews-design.md`

## Global Constraints

- Module name is exactly `"review"` (camelCase, no dashes) — `Module("review", { service: ReviewModuleService })`.
- `rating` is an integer 1–5, `title` and `comment` are required non-empty text. All three plus `product_id` are required on create.
- New/edited reviews always get `status: "pending"`. There is no public read endpoint in this piece.
- "Verified purchase" = the customer has at least one order with `status !== "canceled"` containing a line item whose `product_id` matches. Payment/fulfillment status is irrelevant.
- One review per `(customer_id, product_id)`: a second submission updates the existing row (same `id`), it never creates a second row.
- Only GET, POST, DELETE methods. All mutations go through a workflow; no business logic or ownership checks in route handlers.
- `/store/reviews*` needs an explicit `authenticate("customer", ["session", "bearer"])` middleware entry (it is not under an auto-protected prefix); `/admin/reviews*` needs none (auto-protected).
- No semicolons, double quotes, 2-space indent, kebab-case filenames (per `AGENTS.md`).

## Review Focus

- A submitted `rating` of `0`, `6`, `3.5`, or a missing field must be rejected before the workflow runs, not merely produce a bad review row. (Task 4)
- A review whose linked product has since been deleted must render as `product: null` in the admin list, not throw or omit the row entirely. (Task 7)
- A review created from a now-canceled order must still appear and remain usable — the purchase check gates creation/update only, it is never re-validated on read. (Task 7)
- Editing (re-`POST`ing) a review that is currently `approved` must reset it to `pending` — an admin-approved review's text can't silently change without re-moderation. (Task 6)
- Approving or rejecting a review id that doesn't exist must 404 cleanly, not throw an unhandled error. (Task 6)

---

### Task 1: Review module

**Files:**
- Create: `apps/backend/src/modules/review/models/review.ts`
- Create: `apps/backend/src/modules/review/service.ts`
- Create: `apps/backend/src/modules/review/index.ts`
- Modify: `apps/backend/medusa-config.ts` (add `{ resolve: "./src/modules/review" }` to the `modules` array, matching that array's existing quote style)
- Test: `apps/backend/src/modules/review/__tests__/review-module-service.spec.ts`

**Interfaces:**
- Produces: `REVIEW_MODULE = "review"` (exported from `index.ts`); `ReviewModuleService` resolvable via `container.resolve("review")` with auto-generated `createReviews`, `listReviews`, `listAndCountReviews`, `retrieveReview`, `updateReviews`, `deleteReviews`. A `Review` row shape: `{ id, product_id, customer_id, order_id: string | null, rating: number, title: string, comment: string, status: "pending" | "approved" | "rejected", created_at, updated_at, deleted_at }`.

- [ ] **Step 1: Write the failing module integration test**

```typescript
// apps/backend/src/modules/review/__tests__/review-module-service.spec.ts
import path from "path"
import { moduleIntegrationTestRunner } from "@medusajs/test-utils"
import ReviewModuleService from "../service"

moduleIntegrationTestRunner<ReviewModuleService>({
  moduleName: "review",
  resolve: path.resolve(__dirname, ".."),
  testSuite: ({ service }) => {
    describe("ReviewModuleService", () => {
      it("creates a review defaulting to pending status", async () => {
        const review = await service.createReviews({
          product_id: "prod_1",
          customer_id: "cus_1",
          order_id: "order_1",
          rating: 5,
          title: "Great",
          comment: "Loved it",
        })
        expect(review.status).toBe("pending")
      })

      it("updates a review's status", async () => {
        const review = await service.createReviews({
          product_id: "prod_1",
          customer_id: "cus_1",
          order_id: "order_1",
          rating: 3,
          title: "OK",
          comment: "Fine",
        })
        const [updated] = await service.updateReviews({
          id: review.id,
          status: "approved",
        })
        expect(updated.status).toBe("approved")
      })
    })
  },
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && yarn test:integration:modules -- src/modules/review/__tests__/review-module-service.spec.ts`
Expected: FAIL (module `review` / `../service` not found)

- [ ] **Step 3: Implement the data model in `apps/backend/src/modules/review/models/review.ts`**

Exactly the fields listed in this task's Interfaces block, using `model.define("review", { ... })`. `rating: model.number()` (range is validated at the API layer, not here — DML has no numeric range modifier). `status: model.enum(["pending", "approved", "rejected"]).default("pending")`. `order_id: model.text().nullable()`.

- [ ] **Step 4: Implement the service in `apps/backend/src/modules/review/service.ts`**

`class ReviewModuleService extends MedusaService({ Review })` — import `Review` from `./models/review`, `MedusaService` from `@medusajs/framework/utils`. Default export.

- [ ] **Step 5: Implement the module definition in `apps/backend/src/modules/review/index.ts`**

Export `const REVIEW_MODULE = "review"`; default-export `Module(REVIEW_MODULE, { service: ReviewModuleService })` (`Module` from `@medusajs/framework/utils`).

- [ ] **Step 6: Register the module in `apps/backend/medusa-config.ts`**

Add `{ resolve: "./src/modules/review" }` as a new entry in the `modules` array.

- [ ] **Step 7: Generate and run migrations**

Run: `cd apps/backend && yarn exec medusa db:generate review`
Run: `cd apps/backend && yarn exec medusa db:migrate`

- [ ] **Step 8: Run test to verify it passes**

Run: `cd apps/backend && yarn test:integration:modules -- src/modules/review/__tests__/review-module-service.spec.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/modules/review apps/backend/medusa-config.ts apps/backend/src/migrations
git commit -m "feat(backend): add review module with create/update/status fields"
```

---

### Task 2: Verified-purchase check

**Files:**
- Create: `apps/backend/src/workflows/steps/check-verified-purchase.ts`
- Test: `apps/backend/src/workflows/steps/__tests__/check-verified-purchase.unit.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `findQualifyingOrderId(orders: { id: string; items: { product_id: string | null }[] }[], productId: string): string | null` (pure, exported for the unit test). `checkVerifiedPurchaseStep(input: { customerId: string; productId: string })` — a `createStep` that `query.graph`s the customer's orders (`filters: { customer_id, status: { $ne: "canceled" } }`, `fields: ["id", "items.product_id"]`), calls `findQualifyingOrderId`, and either returns `StepResponse<string>(orderId)` or throws `MedusaError(MedusaError.Types.NOT_ALLOWED, "You can only review products you've purchased.")`. Used by Task 3.

- [ ] **Step 1: Write the failing unit tests for `findQualifyingOrderId`**

```typescript
// apps/backend/src/workflows/steps/__tests__/check-verified-purchase.unit.spec.ts
import { findQualifyingOrderId } from "../check-verified-purchase"

describe("findQualifyingOrderId", () => {
  it("returns the order id when an order contains the product", () => {
    const result = findQualifyingOrderId(
      [{ id: "order_1", items: [{ product_id: "prod_1" }] }],
      "prod_1"
    )
    expect(result).toBe("order_1")
  })

  it("returns null when no order contains the product", () => {
    const result = findQualifyingOrderId(
      [{ id: "order_1", items: [{ product_id: "prod_other" }] }],
      "prod_1"
    )
    expect(result).toBeNull()
  })

  it("returns null for an empty orders list", () => {
    expect(findQualifyingOrderId([], "prod_1")).toBeNull()
  })

  it("ignores an item with a null product_id", () => {
    const result = findQualifyingOrderId(
      [{ id: "order_1", items: [{ product_id: null }] }],
      "prod_1"
    )
    expect(result).toBeNull()
  })

  it("returns the first qualifying order when more than one matches", () => {
    const result = findQualifyingOrderId(
      [
        { id: "order_1", items: [{ product_id: "prod_1" }] },
        { id: "order_2", items: [{ product_id: "prod_1" }] },
      ],
      "prod_1"
    )
    expect(result).toBe("order_1")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && yarn test:unit -- src/workflows/steps/__tests__/check-verified-purchase.unit.spec.ts`
Expected: FAIL (`../check-verified-purchase` has no export `findQualifyingOrderId`)

- [ ] **Step 3: Implement `findQualifyingOrderId` and `checkVerifiedPurchaseStep` in `apps/backend/src/workflows/steps/check-verified-purchase.ts`**

`findQualifyingOrderId` is a plain function: find the first order in the array whose `items` contains an item with `product_id === productId`, return its `id`, else `null`. `checkVerifiedPurchaseStep` resolves `"query"` from the container (not `"review"` — it only reads orders), calls `query.graph`, passes the result to `findQualifyingOrderId`, throws on `null`, otherwise returns `new StepResponse(orderId)`. No compensation function needed (it performs no mutation).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && yarn test:unit -- src/workflows/steps/__tests__/check-verified-purchase.unit.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/workflows/steps/check-verified-purchase.ts apps/backend/src/workflows/steps/__tests__/check-verified-purchase.unit.spec.ts
git commit -m "feat(backend): add verified-purchase check step for reviews"
```

---

### Task 3: Upsert-review workflow and module links

**Files:**
- Create: `apps/backend/src/links/review-product.ts`
- Create: `apps/backend/src/links/review-customer.ts`
- Create: `apps/backend/src/workflows/steps/upsert-review.ts`
- Create: `apps/backend/src/workflows/upsert-review.ts`
- Test: `apps/backend/src/workflows/steps/__tests__/upsert-review.unit.spec.ts`

**Interfaces:**
- Consumes: `checkVerifiedPurchaseStep` (Task 2); `REVIEW_MODULE` (Task 1).
- Produces: `buildReviewUpsertInput(existing: { id: string } | null, input: { product_id: string; customer_id: string; rating: number; title: string; comment: string }, orderId: string): { mode: "create"; data: Record<string, unknown> } | { mode: "update"; id: string; data: Record<string, unknown> }` (pure, exported for the unit test — both branches' `data` always include `status: "pending"` and `order_id: orderId`). `upsertReviewStep(input)` — returns `StepResponse<{ review: Review; wasCreated: boolean }>`. `upsertReviewWorkflow(input: { product_id, customer_id, rating, title, comment })` (default export of `apps/backend/src/workflows/upsert-review.ts`) — returns `WorkflowResponse<{ review: Review }>`. Used by Task 4.

- [ ] **Step 1: Write the failing unit tests for `buildReviewUpsertInput`**

```typescript
// apps/backend/src/workflows/steps/__tests__/upsert-review.unit.spec.ts
import { buildReviewUpsertInput } from "../upsert-review"

const input = {
  product_id: "prod_1",
  customer_id: "cus_1",
  rating: 4,
  title: "Good",
  comment: "Works well",
}

describe("buildReviewUpsertInput", () => {
  it("builds a create payload with pending status and the order id when no existing review", () => {
    const result = buildReviewUpsertInput(null, input, "order_1")
    expect(result.mode).toBe("create")
    expect(result.data).toMatchObject({
      ...input,
      status: "pending",
      order_id: "order_1",
    })
  })

  it("builds an update payload targeting the existing review's id, resetting status to pending", () => {
    const result = buildReviewUpsertInput(
      { id: "review_1" },
      input,
      "order_1"
    )
    expect(result.mode).toBe("update")
    if (result.mode === "update") {
      expect(result.id).toBe("review_1")
    }
    expect(result.data).toMatchObject({
      ...input,
      status: "pending",
      order_id: "order_1",
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && yarn test:unit -- src/workflows/steps/__tests__/upsert-review.unit.spec.ts`
Expected: FAIL (`../upsert-review` has no export `buildReviewUpsertInput`)

- [ ] **Step 3: Implement `buildReviewUpsertInput` and `upsertReviewStep` in `apps/backend/src/workflows/steps/upsert-review.ts`**

`buildReviewUpsertInput` is a plain function per the signature above. `upsertReviewStep` resolves `"review"` from the container, calls `reviewModule.listReviews({ customer_id, product_id })` to find an existing row, calls `buildReviewUpsertInput`, then `createReviews`/`updateReviews` accordingly, and returns `new StepResponse({ review, wasCreated: result.mode === "create" }, { reviewId: review.id, wasCreated: ... })` (compensation input carries enough to undo: delete on create, nothing to revert on update since the prior values aren't restorable without a snapshot — leave the update branch's compensation as a no-op, noted inline as an accepted limitation). Compensation function: if `wasCreated`, `reviewModule.deleteReviews(reviewId)`; else no-op.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && yarn test:unit -- src/workflows/steps/__tests__/upsert-review.unit.spec.ts`
Expected: PASS

- [ ] **Step 5: Create the module links**

`apps/backend/src/links/review-product.ts`:
```typescript
import { defineLink } from "@medusajs/framework/utils"
import ReviewModule from "../modules/review"
import ProductModule from "@medusajs/medusa/product"

export default defineLink(
  { linkable: ReviewModule.linkable.review, isList: true },
  ProductModule.linkable.product
)
```
`apps/backend/src/links/review-customer.ts` — identical shape, `CustomerModule from "@medusajs/medusa/customer"` in place of `ProductModule`.

- [ ] **Step 6: Run migrations to sync the links**

Run: `cd apps/backend && yarn exec medusa db:migrate`

- [ ] **Step 7: Implement `upsertReviewWorkflow` in `apps/backend/src/workflows/upsert-review.ts`**

```typescript
const upsertReviewWorkflow = createWorkflow(
  "upsert-review",
  function (input: UpsertReviewInput) {
    const orderId = checkVerifiedPurchaseStep({
      customerId: input.customer_id,
      productId: input.product_id,
    })
    const result = upsertReviewStep(
      transform({ input, orderId }, (data) => ({ ...data.input, orderId: data.orderId }))
    )

    const linkData = transform({ result }, ({ result }) => [
      {
        review: { review_id: result.review.id },
        [Modules.PRODUCT]: { product_id: result.review.product_id },
      },
      {
        review: { review_id: result.review.id },
        [Modules.CUSTOMER]: { customer_id: result.review.customer_id },
      },
    ])

    when(result, (result) => result.wasCreated).then(function () {
      createRemoteLinkStep(linkData)
    })

    return new WorkflowResponse({ review: result.review })
  }
)
```
Note object-spread (`...data.input`) is only used inside a `transform()` callback, which runs at execution time — that's allowed; only the composition function body itself may not spread directly. Imports: `createWorkflow`, `WorkflowResponse`, `transform`, `when` from `@medusajs/framework/workflows-sdk`; `createRemoteLinkStep` from `@medusajs/medusa/core-flows`; `Modules` from `@medusajs/framework/utils`.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/links apps/backend/src/workflows/steps/upsert-review.ts apps/backend/src/workflows/steps/__tests__/upsert-review.unit.spec.ts apps/backend/src/workflows/upsert-review.ts apps/backend/src/migrations
git commit -m "feat(backend): add upsert-review workflow with product/customer links"
```

---

### Task 4: Store `POST /store/reviews`

**Files:**
- Create: `apps/backend/src/api/store/reviews/middlewares.ts`
- Create: `apps/backend/src/api/store/reviews/route.ts`
- Modify: `apps/backend/src/api/middlewares.ts`
- Test: `apps/backend/integration-tests/http/reviews.spec.ts`

**Interfaces:**
- Consumes: `upsertReviewWorkflow` (Task 3).
- Produces: `CreateReviewSchema` / `CreateReviewSchema` type (exported from `middlewares.ts`); `POST /store/reviews` returning `{ review }` (200) or throwing (403 no qualifying order, 400 invalid body, 401 unauthenticated).

- [ ] **Step 1: Write the failing integration tests**

```typescript
// apps/backend/integration-tests/http/reviews.spec.ts
// Follow this repo's existing integration-tests/http setup.js conventions
// (real backend, seeded customer/product/order fixtures via the test API,
// not mocks) -- mirror an existing spec in this directory for the exact
// auth-header/axios helper this repo uses.
describe("POST /store/reviews", () => {
  it("creates a pending review when the customer has a non-canceled order containing the product", async () => {
    // seed: customer, product, a completed (non-canceled) order containing the product
    // POST /store/reviews as that customer with { product_id, rating: 5, title, comment }
    // expect 200, response.review.status === "pending"
  })

  it("returns 403 when the customer has no order containing the product", async () => {
    // seed: customer, product, no order for it
    // POST /store/reviews as that customer
    // expect 403
  })

  it("updates the same review id and resets status to pending on a second submission", async () => {
    // POST once (seeded qualifying order), capture review.id
    // POST again with different rating/title/comment
    // expect same id, new content, status still "pending"
  })

  it("rejects an unauthenticated request with 401", async () => {
    // POST without auth headers, expect 401
  })

  it("rejects rating 0, rating 6, and a missing rating with 400", async () => {
    // three POSTs, each expect 400, none create a review
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && yarn test:integration:http -- reviews.spec.ts`
Expected: FAIL (`/store/reviews` 404s)

- [ ] **Step 3: Implement the validation middleware in `apps/backend/src/api/store/reviews/middlewares.ts`**

```typescript
export const CreateReviewSchema = z.object({
  product_id: z.string(),
  rating: z.number().int().min(1).max(5),
  title: z.string().min(1),
  comment: z.string().min(1),
})
export type CreateReviewSchema = z.infer<typeof CreateReviewSchema>

export const reviewMiddlewares: MiddlewareRoute[] = [
  {
    matcher: "/store/reviews",
    method: "POST",
    middlewares: [validateAndTransformBody(CreateReviewSchema)],
  },
]
```
Imports: `MiddlewareRoute`, `validateAndTransformBody` from `@medusajs/framework/http`; `z` from `@medusajs/framework/zod`.

- [ ] **Step 4: Implement the route in `apps/backend/src/api/store/reviews/route.ts`**

```typescript
export async function POST(
  req: AuthenticatedMedusaRequest<CreateReviewSchema>,
  res: MedusaResponse
) {
  const { result } = await upsertReviewWorkflow(req.scope).run({
    input: {
      product_id: req.validatedBody.product_id,
      customer_id: req.auth_context.actor_id,
      rating: req.validatedBody.rating,
      title: req.validatedBody.title,
      comment: req.validatedBody.comment,
    },
  })
  return res.json({ review: result.review })
}
```
Imports: `AuthenticatedMedusaRequest`, `MedusaResponse` from `@medusajs/framework/http`; `upsertReviewWorkflow` from `../../../workflows/upsert-review`; `CreateReviewSchema` from `./middlewares`.

- [ ] **Step 5: Register the auth middleware in `apps/backend/src/api/middlewares.ts`**

Add `...reviewMiddlewares` to the existing `routes` array (import from `./store/reviews/middlewares`), plus a new entry: `{ matcher: "/store/reviews*", middlewares: [authenticate("customer", ["session", "bearer"])] }` (import `authenticate` alongside the existing `defineMiddlewares` import). Order matters: the `authenticate` entry and the `reviewMiddlewares` entries both apply to the same path; per the skill's documented pattern, authentication and validation can be two separate route entries in the same array (both match `/store/reviews` and both sets of middlewares run).

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/backend && yarn test:integration:http -- reviews.spec.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/api/store/reviews apps/backend/src/api/middlewares.ts apps/backend/integration-tests/http/reviews.spec.ts
git commit -m "feat(backend): add POST /store/reviews"
```

---

### Task 5: Store `DELETE /store/reviews/:id`

**Files:**
- Create: `apps/backend/src/workflows/steps/delete-review.ts`
- Create: `apps/backend/src/workflows/delete-review.ts`
- Create: `apps/backend/src/api/store/reviews/[id]/route.ts`
- Modify: `apps/backend/integration-tests/http/reviews.spec.ts`

**Interfaces:**
- Consumes: `REVIEW_MODULE` (Task 1).
- Produces: `validateReviewOwnershipStep(input: { reviewId: string; customerId: string })` — returns `StepResponse<Review>`, throws `MedusaError.Types.NOT_ALLOWED` on mismatch (the auto-generated `retrieveReview` throws `NOT_FOUND` on a bad id, which is also the desired 404 behavior). `deleteReviewWorkflow(input: { reviewId: string; customerId: string })` default export of `apps/backend/src/workflows/delete-review.ts` — `WorkflowResponse<{ success: true }>`.

- [ ] **Step 1: Add the failing integration tests**

```typescript
// append to apps/backend/integration-tests/http/reviews.spec.ts
describe("DELETE /store/reviews/:id", () => {
  it("deletes the caller's own review", async () => {
    // create a review as customer A, DELETE it as customer A, expect 204 (or 200)
  })

  it("returns 403 when deleting another customer's review", async () => {
    // create a review as customer A, DELETE it as customer B, expect 403
  })

  it("returns 404 when the review id does not exist", async () => {
    // DELETE a made-up id as any authenticated customer, expect 404
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && yarn test:integration:http -- reviews.spec.ts`
Expected: FAIL (new `describe` block 404s)

- [ ] **Step 3: Implement `validateReviewOwnershipStep` in `apps/backend/src/workflows/steps/delete-review.ts`**

Resolve `"review"`, `retrieveReview(reviewId)` (throws `NOT_FOUND` automatically on a bad id — do not catch and re-throw, let it propagate), compare `review.customer_id !== customerId` and throw `NOT_ALLOWED` if so, else `return new StepResponse(review)`.

- [ ] **Step 4: Implement `deleteReviewWorkflow` in `apps/backend/src/workflows/delete-review.ts`**

```typescript
const deleteReviewWorkflow = createWorkflow(
  "delete-review",
  function (input: DeleteReviewInput) {
    const review = validateReviewOwnershipStep(input)

    const linkData = transform({ review }, ({ review }) => [
      {
        review: { review_id: review.id },
        [Modules.PRODUCT]: { product_id: review.product_id },
      },
      {
        review: { review_id: review.id },
        [Modules.CUSTOMER]: { customer_id: review.customer_id },
      },
    ])

    dismissRemoteLinkStep(linkData)
    deleteReviewRowStep(review)

    return new WorkflowResponse({ success: true })
  }
)
```
`deleteReviewRowStep` is a small additional step in the same file: resolve `"review"`, `reviewModule.deleteReviews(review.id)`, `return new StepResponse({ id: review.id }, review.id)` (compensation intentionally omitted — a deleted review is not restored on workflow failure after this point, an accepted limitation for a delete operation).

- [ ] **Step 5: Implement the route in `apps/backend/src/api/store/reviews/[id]/route.ts`**

```typescript
export async function DELETE(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  await deleteReviewWorkflow(req.scope).run({
    input: { reviewId: req.params.id, customerId: req.auth_context.actor_id },
  })
  return res.status(204).send()
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/backend && yarn test:integration:http -- reviews.spec.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/workflows/steps/delete-review.ts apps/backend/src/workflows/delete-review.ts "apps/backend/src/api/store/reviews/[id]" apps/backend/integration-tests/http/reviews.spec.ts
git commit -m "feat(backend): add DELETE /store/reviews/:id"
```

---

### Task 6: Admin approve/reject

**Files:**
- Create: `apps/backend/src/workflows/steps/update-review-status.ts`
- Create: `apps/backend/src/workflows/update-review-status.ts`
- Create: `apps/backend/src/api/admin/reviews/[id]/approve/route.ts`
- Create: `apps/backend/src/api/admin/reviews/[id]/reject/route.ts`
- Modify: `apps/backend/integration-tests/http/reviews.spec.ts`

**Interfaces:**
- Consumes: `REVIEW_MODULE` (Task 1); `upsertReviewWorkflow` (Task 3, reused only inside a test to exercise the "resets to pending" case).
- Produces: `updateReviewStatusWorkflow(input: { reviewId: string; status: "approved" | "rejected" })` default export of `apps/backend/src/workflows/update-review-status.ts` — `WorkflowResponse<{ review: Review }>`. Used by Task 7's admin list only indirectly (not consumed there, but documents the full moderation surface).

- [ ] **Step 1: Add the failing integration tests**

```typescript
// append to apps/backend/integration-tests/http/reviews.spec.ts
describe("POST /admin/reviews/:id/approve and /reject", () => {
  it("approves a pending review", async () => {
    // create a review, POST .../approve as an admin user, expect review.status === "approved"
  })

  it("rejects a pending review", async () => {
    // create a review, POST .../reject as an admin user, expect review.status === "rejected"
  })

  it("is a no-op success when approving an already-approved review", async () => {
    // approve once, approve again, expect 200 and status still "approved"
  })

  it("returns 404 when approving a review id that does not exist", async () => {
    // POST /admin/reviews/review_does_not_exist/approve, expect 404
  })

  it("resets an approved review back to pending when the customer edits it", async () => {
    // create + approve a review, then POST /store/reviews again as the same
    // customer for the same product with different content
    // expect the review's status to be "pending" again
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && yarn test:integration:http -- reviews.spec.ts`
Expected: FAIL (new routes 404)

- [ ] **Step 3: Implement `updateReviewStatusStep` in `apps/backend/src/workflows/steps/update-review-status.ts`**

Resolve `"review"`, `retrieveReview(reviewId)` first (so a bad id throws `NOT_FOUND`/404 before any write), capture `previousStatus`, then `updateReviews({ id: reviewId, status })`, `return new StepResponse(updatedReview, { reviewId, previousStatus })`. Compensation: `updateReviews({ id: reviewId, status: previousStatus })`.

- [ ] **Step 4: Implement `updateReviewStatusWorkflow` in `apps/backend/src/workflows/update-review-status.ts`**

Single-step composition, same shape as Task 1's example workflow: call `updateReviewStatusStep(input)`, `return new WorkflowResponse({ review: result })`.

- [ ] **Step 5: Implement the two routes**

`apps/backend/src/api/admin/reviews/[id]/approve/route.ts`:
```typescript
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { result } = await updateReviewStatusWorkflow(req.scope).run({
    input: { reviewId: req.params.id, status: "approved" },
  })
  return res.json({ review: result.review })
}
```
`apps/backend/src/api/admin/reviews/[id]/reject/route.ts` — identical, `status: "rejected"`.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/backend && yarn test:integration:http -- reviews.spec.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/workflows/steps/update-review-status.ts apps/backend/src/workflows/update-review-status.ts "apps/backend/src/api/admin/reviews/[id]" apps/backend/integration-tests/http/reviews.spec.ts
git commit -m "feat(backend): add admin review approve/reject routes"
```

---

### Task 7: Admin `GET /admin/reviews` list

**Files:**
- Create: `apps/backend/src/api/admin/reviews/map-review.ts`
- Create: `apps/backend/src/api/admin/reviews/route.ts`
- Test: `apps/backend/src/api/admin/reviews/__tests__/map-review.unit.spec.ts`
- Modify: `apps/backend/integration-tests/http/reviews.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks directly (queries the `review` entity's linked fields via `query.graph`).
- Produces: `mapReviewForAdminList(review: { id: string; rating: number; title: string; comment: string; status: string; created_at: string; product: { id: string; title: string } | null; customer: { id: string; email: string } | null }): AdminReviewListItem` (pure, exported for the unit test — passes every field through, substituting `null` for a missing `product`/`customer` rather than throwing). `GET /admin/reviews` returning `{ reviews, count, offset, limit }` per the spec's API contract.

- [ ] **Step 1: Write the failing unit test for `mapReviewForAdminList`**

```typescript
// apps/backend/src/api/admin/reviews/__tests__/map-review.unit.spec.ts
import { mapReviewForAdminList } from "../map-review"

function baseReview(overrides: Record<string, unknown> = {}) {
  return {
    id: "review_1",
    rating: 5,
    title: "Great",
    comment: "Loved it",
    status: "pending",
    created_at: "2026-11-04T00:00:00.000Z",
    product: { id: "prod_1", title: "Widget" },
    customer: { id: "cus_1", email: "customer@example.com" },
    ...overrides,
  } as any
}

describe("mapReviewForAdminList", () => {
  it("passes product and customer through when present", () => {
    const result = mapReviewForAdminList(baseReview())
    expect(result.product).toEqual({ id: "prod_1", title: "Widget" })
  })

  it("maps a deleted/missing product to null instead of throwing", () => {
    const result = mapReviewForAdminList(baseReview({ product: null }))
    expect(result.product).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && yarn test:unit -- src/api/admin/reviews/__tests__/map-review.unit.spec.ts`
Expected: FAIL (`../map-review` not found)

- [ ] **Step 3: Implement `mapReviewForAdminList` in `apps/backend/src/api/admin/reviews/map-review.ts`**

Plain function matching the signature above: build the output object, setting `product: review.product ? { id: review.product.id, title: review.product.title } : null` and the same pattern for `customer`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && yarn test:unit -- src/api/admin/reviews/__tests__/map-review.unit.spec.ts`
Expected: PASS

- [ ] **Step 5: Add the failing integration tests**

```typescript
// append to apps/backend/integration-tests/http/reviews.spec.ts
describe("GET /admin/reviews", () => {
  it("lists reviews with product and customer details", async () => {
    // seed one review, GET /admin/reviews, expect it in reviews[] with product/customer populated
  })

  it("filters by status", async () => {
    // seed one pending + one approved review, GET ?status=approved, expect only the approved one
  })

  it("filters by product_id", async () => {
    // seed reviews for two different products, GET ?product_id=X, expect only that product's review
  })

  it("paginates with offset/limit", async () => {
    // seed 3 reviews, GET ?limit=2&offset=1, expect 2 results and count === 3
  })

  it("still returns a review whose order was canceled after the review was created", async () => {
    // create a qualifying order + review, cancel the order via the admin order-cancel flow,
    // GET /admin/reviews, expect the review still present and unchanged
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd apps/backend && yarn test:integration:http -- reviews.spec.ts`
Expected: FAIL (`/admin/reviews` 404s)

- [ ] **Step 7: Implement the route in `apps/backend/src/api/admin/reviews/route.ts`**

```typescript
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve("query")
  const offset = Number(req.query.offset ?? 0)
  const limit = Number(req.query.limit ?? 20)
  const status = req.query.status as string | undefined
  const productId = req.query.product_id as string | undefined

  const filters: Record<string, unknown> = {}
  if (status) filters.status = status
  if (productId) filters.product_id = productId

  const { data, metadata } = await query.graph({
    entity: "review",
    fields: [
      "id", "rating", "title", "comment", "status", "created_at",
      "product.id", "product.title", "customer.id", "customer.email",
    ],
    filters,
    pagination: { take: limit, skip: offset },
  })

  return res.json({
    reviews: data.map(mapReviewForAdminList),
    count: metadata.count,
    offset,
    limit,
  })
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd apps/backend && yarn test:integration:http -- reviews.spec.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/api/admin/reviews apps/backend/integration-tests/http/reviews.spec.ts
git commit -m "feat(backend): add admin review listing with status/product filters"
```

---

### Task 8: Admin "Reviews" page

**Files:**
- Create: `apps/backend/src/admin/routes/reviews/page.tsx`
- Test: `apps/backend/src/admin/routes/reviews/__tests__/page.unit.spec.tsx`

**Interfaces:**
- Consumes: `GET /admin/reviews` and `POST /admin/reviews/:id/approve` / `.../reject` (Tasks 6–7) via `sdk.client.fetch`.
- Produces: a sidebar page labeled "Reviews" at `/app/reviews`.

- [ ] **Step 1: Write the failing page unit spec**

Mirror the structure of `apps/backend/src/admin/routes/settings/fulfillment/__tests__/page.unit.spec.tsx` and `apps/backend/src/admin/routes/fulfillment-queue/page.tsx`'s own test (if one exists) for the exact test-setup boilerplate (QueryClientProvider wrapper, mocking `sdk.client.fetch`). Cases:

```typescript
// apps/backend/src/admin/routes/reviews/__tests__/page.unit.spec.tsx
describe("ReviewsPage", () => {
  it("renders a row per review with product, customer, rating, status", () => {})
  it("shows Approve and Reject buttons only for a pending review", () => {})
  it("calls POST /admin/reviews/:id/approve when Approve is clicked", () => {})
  it("switches the status query param when a different tab is clicked", () => {})
  it("shows an empty state when there are no reviews for the selected tab", () => {})
  it("shows an inline error with a Retry button when the request fails", () => {})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && yarn test:unit -- src/admin/routes/reviews/__tests__/page.unit.spec.tsx`
Expected: FAIL (`../page` not found)

- [ ] **Step 3: Implement `apps/backend/src/admin/routes/reviews/page.tsx`**

Follow `apps/backend/src/admin/routes/fulfillment-queue/page.tsx`'s exact shape: `useState` for `offset` and `status` (default `"pending"`), a `useQuery` keyed on `["admin", "reviews", status, offset]` calling `sdk.client.fetch<AdminReviewsResponse>("/admin/reviews", { query: { status: status === "all" ? undefined : status, offset, limit: 20 } })`, a `Tabs` row (All/Pending/Approved/Rejected) that sets `status` and resets `offset` to `0`, a `Table` with columns Product/Customer/Rating/Title/Comment/Status/Date, an `approveReview`/`rejectReview` `useMutation` pair (each `sdk.client.fetch("/admin/reviews/" + id + "/approve", { method: "POST" })`) that `invalidateQueries(["admin", "reviews"])` on success, loading/error/empty states matching Fulfillment Queue's, and prev/next pagination buttons. `export const config = defineRouteConfig({ label: "Reviews" })`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && yarn test:unit -- src/admin/routes/reviews/__tests__/page.unit.spec.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/admin/routes/reviews
git commit -m "feat(dashboard): add admin Reviews moderation page"
```

---

### Task 9: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the backend build**

Run: `cd apps/backend && yarn build`
Expected: succeeds with no type errors.

- [ ] **Step 2: Run the backend lint**

Run: `cd apps/backend && yarn exec medusa lint`
Expected: no errors in any file created/modified by this plan (pre-existing unrelated lint debt elsewhere in the repo is out of scope).

- [ ] **Step 3: Run every test file this plan added**

Run: `cd apps/backend && yarn test:unit -- src/workflows/steps/__tests__/check-verified-purchase.unit.spec.ts src/workflows/steps/__tests__/upsert-review.unit.spec.ts src/api/admin/reviews/__tests__/map-review.unit.spec.ts src/admin/routes/reviews/__tests__/page.unit.spec.tsx`
Run: `cd apps/backend && yarn test:integration:modules -- src/modules/review/__tests__/review-module-service.spec.ts`
Run: `cd apps/backend && yarn test:integration:http -- reviews.spec.ts`
Expected: all PASS.

- [ ] **Step 4: Commit (only if Steps 1–2 required fixes)**

```bash
git add -A
git commit -m "fix(backend): address build/lint findings in reviews feature"
```
