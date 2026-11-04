# Product Reviews (Backend + Admin Moderation) — Design

## Purpose

Let authenticated customers leave a star rating, title, and comment on a
product they've actually bought, and let admin users moderate those
reviews (approve/reject) from a dashboard page before anything about a
review is exposed publicly. This is the first of four planned review-
related pieces; the public-facing storefront display of approved reviews
is a separate, later piece and is explicitly out of scope here.

**Intended outcome:** a customer can `POST` a review for a product they
ordered; an admin opens a "Reviews" page, sees every review (filterable
by status), and approves or rejects each one. Nothing about a review is
readable by anyone other than its author and admin users until approved
— there is no public read endpoint in this piece.

**Explicitly out of scope for this piece:**
- Any public/storefront-facing endpoint for reading approved reviews
  (`GET /store/products/:id/reviews` and its pagination — that's the
  fourth planned piece, which depends on this one).
- Notifying the customer by email when their review is approved/rejected.
- A customer-facing "my reviews" list endpoint.
- A DB-level composite uniqueness constraint (see "Known tradeoff"
  below).

## Decisions carried from brainstorming

- **Verified purchase required.** A review may only be created for a
  product the reviewing customer has an order for. "Has an order for"
  means: at least one of the customer's orders (`status != "canceled"`)
  contains a line item with that `product_id`. Fulfillment/payment status
  is *not* checked — an order only needs to exist and not be canceled.
  This is a deliberate simplification: requiring delivery would block
  legitimate early reviews and nothing in the request asked for it.
- **One review per customer per product; editable/deletable.** Submitting
  a review for a product the customer already reviewed updates the
  existing row in place (same id) rather than creating a second one, and
  always resets `status` back to `pending` (an edited review re-enters
  moderation — an approved review's text can't change without admin
  seeing it again). The customer can also delete their own review.
- **Fields:** `rating` (integer 1–5), `title` (text), `comment` (text).
  All required.
- **Default status:** `pending`. A review is invisible to everyone but
  its author and admin users until an admin approves it.

## Known tradeoff

"One review per customer per product" is enforced in the workflow (look
up the existing review for `(customer_id, product_id)`, then create or
update) rather than a database-level composite unique constraint —
Medusa's model DML only documents a single-column `.unique()`. A
near-simultaneous double-submit from the same customer for the same
product could theoretically race into two rows. This is accepted as a
low-probability edge case for a review-submission form, not fixed here.

## Architecture

```
New module: apps/backend/src/modules/review/
  models/review.ts   — the Review data model (see below)
  service.ts         — ReviewModuleService extends MedusaService({ Review })
  index.ts           — exports REVIEW_MODULE = "review"

New links (one per file, src/links/):
  review-product.ts  — defineLink(ReviewModule.linkable.review, ProductModule.linkable.product)
  review-customer.ts — defineLink(ReviewModule.linkable.review, CustomerModule.linkable.customer)

New workflows (apps/backend/src/workflows/):
  upsert-review.ts         — steps/upsert-review.ts does the purchase
                              check + find-or-create/update
  delete-review.ts         — steps/delete-review.ts validates ownership
                              then deletes
  update-review-status.ts  — steps/update-review-status.ts sets status

New API routes (apps/backend/src/api/):
  store/reviews/route.ts            — POST  (create/update own review)
  store/reviews/[id]/route.ts       — DELETE (delete own review)
  admin/reviews/route.ts            — GET   (list, paginated, filterable)
  admin/reviews/[id]/approve/route.ts — POST (approve)
  admin/reviews/[id]/reject/route.ts  — POST (reject)

New middleware entry (apps/backend/src/api/middlewares.ts — extends the
existing array, does not replace it):
  matcher: "/store/reviews*"
  middlewares: [authenticate("customer", ["session", "bearer"])]
  (admin/reviews is under /admin/* — already auto-protected, no entry needed)

New admin UI page (apps/backend/src/admin/routes/reviews/page.tsx)
  — same shape as the existing Fulfillment Queue page.
```

### Data model

```typescript
// apps/backend/src/modules/review/models/review.ts
const Review = model.define("review", {
  id: model.id().primaryKey(),
  product_id: model.text(),
  customer_id: model.text(),
  order_id: model.text().nullable(), // the order that satisfied the purchase check
  rating: model.number(),
  title: model.text(),
  comment: model.text(),
  status: model.enum(["pending", "approved", "rejected"]).default("pending"),
})
```

`rating`'s 1–5 range is validated in the workflow step, not the model
(DML has no numeric range modifier).

### `upsert-review` workflow

1. `checkVerifiedPurchaseStep(customer_id, product_id)` — `query.graph`
   on `order`, filtered to `customer_id`, `status: { $ne: "canceled" }`,
   fields including `items.product_id`. If no matching order contains
   the product, throw `MedusaError.Types.NOT_ALLOWED`. Returns the
   matching order's `id` (first match) for `order_id`.
2. `findExistingReviewStep(customer_id, product_id)` — looks up an
   existing review via the module service.
3. `upsertReviewStep` — if found, `updateReviews` with the new
   `rating`/`title`/`comment`, `status: "pending"`; else `createReviews`
   with `status: "pending"` and the `order_id` from step 1. Then
   `createRemoteLinkStep`s connect the new review to its product and
   customer (skipped on update — the links already exist).

### `delete-review` workflow

1. `retrieveReviewStep(reviewId)`.
2. If `review.customer_id !== customerId`, throw
   `MedusaError.Types.NOT_ALLOWED` ("You can only delete your own
   review.").
3. `deleteReviewsStep(reviewId)`.

### `update-review-status` workflow

Input: `{ reviewId, status: "approved" | "rejected" }`. One step sets
the review's `status`. Shared by both the approve and reject routes
(status is the only thing that differs).

## API contract

**`POST /store/reviews`**
Body: `{ product_id: string, rating: number, title: string, comment: string }`
`customer_id` comes from `req.auth_context.actor_id`, never the body.
Response: `{ review: Review }`. 403 (`NOT_ALLOWED`) if no qualifying
order exists for that product.

**`DELETE /store/reviews/:id`**
Response: `204`. 403 if the review isn't the caller's.

**`GET /admin/reviews?status=pending&product_id=&offset=0&limit=20`**
`status` and `product_id` are both optional filters; omitting `status`
returns all statuses. Response:
```json
{
  "reviews": [
    {
      "id": "review_...",
      "rating": 5,
      "title": "Great fit",
      "comment": "...",
      "status": "pending",
      "created_at": "2026-11-04T...",
      "product": { "id": "prod_...", "title": "..." },
      "customer": { "id": "cus_...", "email": "...", "first_name": "...", "last_name": "..." }
    }
  ],
  "count": 1,
  "offset": 0,
  "limit": 20
}
```
`product` and `customer` are fetched via `query.graph`'s linked-field
dot notation (`product.*`, `customer.*`) off the `review` entity — no
`query.index()` needed since there's no cross-module *filtering* by
those linked fields here, only retrieval.

**`POST /admin/reviews/:id/approve`** / **`POST /admin/reviews/:id/reject`**
No body. Response: `{ review: Review }` with the updated `status`.

## UI

New sidebar page "Reviews" (`defineRouteConfig({ label: "Reviews" })`),
modeled on the existing Fulfillment Queue page:

- Status tabs: All / Pending / Approved / Rejected (drives the `status`
  query param; "All" omits it). Pending is the tab selected by default
  on first load, since that's the actionable queue.
- Table columns: Product (title), Customer (email), Rating (stars or
  "4/5" text), Title, Comment (truncated with a `title` attribute for
  the full text on hover), Status (badge), Date.
- Row actions: when `status === "pending"`, show "Approve" and "Reject"
  buttons (secondary/danger). When already approved/rejected, no actions
  — re-moderation isn't a requirement here.
- Pagination: offset/limit prev/next, same convention as Fulfillment
  Queue.
- **Loading state:** spinner while the request is in flight.
- **Error state:** inline message + Retry button, same pattern as
  Fulfillment Queue — never a silent empty table.
- **Empty state:** "No reviews yet" (All tab) / "No pending reviews"
  (Pending tab), etc., mirroring the selected tab.

## Testing

Following this repo's established convention of integration tests
against a real running backend (no mocked DB):

- `apps/backend/integration-tests/http/reviews.spec.ts`:
  - A customer with a non-canceled order containing the product can
    `POST /store/reviews` successfully; one without such an order gets
    403.
  - Submitting a second review for the same product by the same
    customer updates the existing row (same `id`, new content, status
    reset to `pending`) rather than creating a second row.
  - `DELETE /store/reviews/:id` by the owning customer succeeds; by a
    different customer returns 403.
  - `GET /admin/reviews` filters correctly by `status` and `product_id`,
    and paginates.
  - `POST /admin/reviews/:id/approve` and `.../reject` each flip
    `status` and are idempotent-safe to call again (re-approving an
    already-approved review is a no-op success, not an error).
  - An unauthenticated `POST /store/reviews` is rejected (401) by the
    new middleware entry.
- Unit tests (`src/workflows/__tests__/`) for the purchase-check step in
  isolation (matching order present / absent / only a canceled order
  present) and the upsert step's create-vs-update branching.
- A dashboard unit spec for the new admin page
  (`apps/backend/src/admin/routes/reviews/__tests__/page.unit.spec.tsx`),
  matching the existing `fulfillment/__tests__/page.unit.spec.tsx`
  convention: renders rows, approve/reject buttons call the right
  routes, tab switching changes the `status` query param.

## Review Focus

- `rating` outside 1–5 (including non-integer or missing) must be
  rejected by Zod validation at the route (`z.number().int().min(1).max(5)`)
  before the workflow ever runs — not just trusted from the client.
- A product that's later deleted: the review's `product_id` link has no
  `deleteCascade`, so the review survives as an orphan; the admin list's
  `query.graph` fetch of `product.*` must tolerate a null product
  (render "—" / "Deleted product", not crash).
- A customer whose *only* qualifying order was later fully canceled
  after they already reviewed: the existing review is **not**
  retroactively revoked — the purchase check only gates creation/update,
  it does not re-validate on every read. This is intentional (simpler,
  and matches how most storefronts behave) but called out so it isn't
  mistaken for an oversight.
- Re-submitting a review that is currently `approved` must still reset
  it to `pending` (per the "editable" decision above) — a customer
  silently editing an already-public review's text without
  re-moderation would defeat the point of moderation.
- Approving/rejecting a review that doesn't exist, or belongs to a
  product that's been deleted, must still 404 cleanly rather than throw
  an unhandled error.
