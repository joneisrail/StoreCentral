import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import {
  ContainerRegistrationKeys,
  generateJwtToken,
  Modules,
  PUBLISHABLE_KEY_HEADER,
} from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { REVIEW_MODULE } from "../../src/modules/review"
import { generatePublishableKey } from "../fixtures/create-admin-user"
import { createAdminUser } from "../helpers/create-admin-user"

jest.setTimeout(60000)

// Every /store/* route requires a publishable API key header regardless of
// auth (see ensurePublishableApiKeyMiddleware), so it is folded into both
// helpers below rather than asserted on separately.
const createPublishableKeyHeaders = async (container: MedusaContainer) => {
  const publishableKey = await generatePublishableKey(container)
  return {
    headers: { [PUBLISHABLE_KEY_HEADER]: publishableKey.token },
  }
}

// Builds a real customer + a real emailpass auth identity, then signs a JWT
// the same way Medusa's own customer login endpoint would (mirrors this
// repo's apps/backend/integration-tests/helpers/create-admin-user.ts, but
// for the "customer" actor type the /store/reviews* middleware requires).
const createCustomerWithAuthHeaders = async (
  container: MedusaContainer,
  email: string
) => {
  const customerModule = container.resolve(Modules.CUSTOMER)
  const authModule = container.resolve(Modules.AUTH)

  const customer = await customerModule.createCustomers({ email })

  const authIdentity = await authModule.createAuthIdentities({
    provider_identities: [
      {
        provider: "emailpass",
        entity_id: email,
        provider_metadata: { password: "unused" },
      },
    ],
    app_metadata: { customer_id: customer.id },
  })

  const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE)
  const { jwtSecret, jwtOptions } = config.projectConfig.http

  const token = generateJwtToken(
    {
      actor_id: customer.id,
      actor_type: "customer",
      auth_identity_id: authIdentity.id,
      auth_provider: "emailpass",
      app_metadata: { customer_id: customer.id },
    },
    { secret: jwtSecret, expiresIn: "1d", jwtOptions }
  )

  const publishableKey = await generatePublishableKey(container)

  return {
    customer,
    headers: {
      headers: {
        authorization: `Bearer ${token}`,
        [PUBLISHABLE_KEY_HEADER]: publishableKey.token,
      },
    },
  }
}

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("POST /store/reviews", () => {
      it("creates a pending review when the customer has a non-canceled order containing the product", async () => {
        const container = getContainer()
        const productModule = container.resolve(Modules.PRODUCT)
        const orderModule = container.resolve(Modules.ORDER)

        const suffix = Date.now()
        const { customer, headers } = await createCustomerWithAuthHeaders(
          container,
          `reviewer-${suffix}@example.com`
        )
        const product = await productModule.createProducts({
          title: "Route test product",
          handle: `route-test-product-${suffix}`,
        })

        await orderModule.createOrders({
          customer_id: customer.id,
          currency_code: "usd",
          items: [
            {
              title: "Test item",
              quantity: 1,
              unit_price: 100,
              product_id: product.id,
            },
          ],
        })

        const response = await api.post(
          "/store/reviews",
          {
            product_id: product.id,
            rating: 5,
            title: "Great product",
            comment: "Loved it",
          },
          headers
        )

        expect(response.status).toBe(200)
        expect(response.data.review.status).toBe("pending")
        expect(response.data.review.product_id).toBe(product.id)
        expect(response.data.review.customer_id).toBe(customer.id)
      })

      // checkVerifiedPurchaseStep (Task 2, read-only) throws
      // MedusaError.Types.NOT_ALLOWED for a non-qualifying customer. The
      // task-4 brief describes this as mapping to HTTP 403, but this repo's
      // installed @medusajs/framework actually maps NOT_ALLOWED -> 400 (see
      // the switch statement in
      // packages/core/framework/src/http/middlewares/error-handler.ts,
      // where only MedusaError.Types.FORBIDDEN maps to 403) -- confirmed
      // empirically by running this exact request against the real route.
      // This test asserts the real, verified behavior rather than the
      // brief's inaccurate claim.
      it("returns 400 when the customer has no order containing the product", async () => {
        const container = getContainer()
        const productModule = container.resolve(Modules.PRODUCT)

        const suffix = Date.now()
        const { headers } = await createCustomerWithAuthHeaders(
          container,
          `no-order-${suffix}@example.com`
        )
        const product = await productModule.createProducts({
          title: "Unpurchased product",
          handle: `unpurchased-product-${suffix}`,
        })

        const response = await api
          .post(
            "/store/reviews",
            {
              product_id: product.id,
              rating: 5,
              title: "Great product",
              comment: "Loved it",
            },
            headers
          )
          .catch((e) => e.response)

        expect(response.status).toBe(400)
      })

      it("updates the same review id and resets status to pending on a second submission", async () => {
        const container = getContainer()
        const productModule = container.resolve(Modules.PRODUCT)
        const orderModule = container.resolve(Modules.ORDER)
        const reviewModule = container.resolve(REVIEW_MODULE)

        const suffix = Date.now()
        const { customer, headers } = await createCustomerWithAuthHeaders(
          container,
          `resubmit-${suffix}@example.com`
        )
        const product = await productModule.createProducts({
          title: "Resubmit product",
          handle: `resubmit-product-${suffix}`,
        })

        await orderModule.createOrders({
          customer_id: customer.id,
          currency_code: "usd",
          items: [
            {
              title: "Test item",
              quantity: 1,
              unit_price: 100,
              product_id: product.id,
            },
          ],
        })

        const first = await api.post(
          "/store/reviews",
          {
            product_id: product.id,
            rating: 4,
            title: "Good",
            comment: "Works well",
          },
          headers
        )

        expect(first.status).toBe(200)
        expect(first.data.review.status).toBe("pending")

        // Force the row away from "pending" directly through the module
        // service -- this proves the second POST actually *resets* status
        // back to "pending" rather than merely leaving an already-pending
        // row untouched.
        await reviewModule.updateReviews({
          id: first.data.review.id,
          status: "approved",
        })

        const second = await api.post(
          "/store/reviews",
          {
            product_id: product.id,
            rating: 2,
            title: "Changed my mind",
            comment: "Not as good as I thought",
          },
          headers
        )

        expect(second.status).toBe(200)
        expect(second.data.review.id).toBe(first.data.review.id)
        expect(second.data.review.rating).toBe(2)
        expect(second.data.review.title).toBe("Changed my mind")
        expect(second.data.review.comment).toBe("Not as good as I thought")
        expect(second.data.review.status).toBe("pending")
      })

      it("rejects an unauthenticated request with 401", async () => {
        const container = getContainer()
        const headers = await createPublishableKeyHeaders(container)

        const response = await api
          .post(
            "/store/reviews",
            {
              product_id: "prod_does_not_matter",
              rating: 5,
              title: "Great product",
              comment: "Loved it",
            },
            headers
          )
          .catch((e) => e.response)

        expect(response.status).toBe(401)
      })

      it("rejects rating 0, rating 6, and a missing rating with 400", async () => {
        const container = getContainer()
        const productModule = container.resolve(Modules.PRODUCT)
        const orderModule = container.resolve(Modules.ORDER)
        const reviewModule = container.resolve(REVIEW_MODULE)

        const suffix = Date.now()
        const { customer, headers } = await createCustomerWithAuthHeaders(
          container,
          `bad-rating-${suffix}@example.com`
        )
        const product = await productModule.createProducts({
          title: "Invalid rating product",
          handle: `invalid-rating-product-${suffix}`,
        })

        await orderModule.createOrders({
          customer_id: customer.id,
          currency_code: "usd",
          items: [
            {
              title: "Test item",
              quantity: 1,
              unit_price: 100,
              product_id: product.id,
            },
          ],
        })

        const basePayload = {
          product_id: product.id,
          title: "Great product",
          comment: "Loved it",
        }

        const zeroRating = await api
          .post("/store/reviews", { ...basePayload, rating: 0 }, headers)
          .catch((e) => e.response)
        expect(zeroRating.status).toBe(400)

        const sixRating = await api
          .post("/store/reviews", { ...basePayload, rating: 6 }, headers)
          .catch((e) => e.response)
        expect(sixRating.status).toBe(400)

        const missingRating = await api
          .post("/store/reviews", basePayload, headers)
          .catch((e) => e.response)
        expect(missingRating.status).toBe(400)

        const reviews = await reviewModule.listReviews({
          product_id: product.id,
          customer_id: customer.id,
        })
        expect(reviews).toHaveLength(0)
      })
    })

    describe("DELETE /store/reviews/:id", () => {
      it("deletes the caller's own review", async () => {
        const container = getContainer()
        const productModule = container.resolve(Modules.PRODUCT)
        const orderModule = container.resolve(Modules.ORDER)
        const reviewModule = container.resolve(REVIEW_MODULE)

        const suffix = Date.now()
        const { customer, headers } = await createCustomerWithAuthHeaders(
          container,
          `delete-owner-${suffix}@example.com`
        )
        const product = await productModule.createProducts({
          title: "Delete test product",
          handle: `delete-test-product-${suffix}`,
        })

        await orderModule.createOrders({
          customer_id: customer.id,
          currency_code: "usd",
          items: [
            {
              title: "Test item",
              quantity: 1,
              unit_price: 100,
              product_id: product.id,
            },
          ],
        })

        const created = await api.post(
          "/store/reviews",
          {
            product_id: product.id,
            rating: 5,
            title: "Great product",
            comment: "Loved it",
          },
          headers
        )
        const reviewId = created.data.review.id

        const linkModule = container.resolve(ContainerRegistrationKeys.LINK)

        const response = await api.delete(`/store/reviews/${reviewId}`, headers)

        expect(response.status).toBe(204)

        await expect(reviewModule.retrieveReview(reviewId)).rejects.toThrow()

        const productLinks = await linkModule.list({
          review: { review_id: reviewId },
          [Modules.PRODUCT]: { product_id: product.id },
        })
        const customerLinks = await linkModule.list({
          review: { review_id: reviewId },
          [Modules.CUSTOMER]: { customer_id: customer.id },
        })
        expect(productLinks).toHaveLength(0)
        expect(customerLinks).toHaveLength(0)
      })

      // validateReviewOwnershipStep throws MedusaError.Types.NOT_ALLOWED on an
      // ownership mismatch. The brief describes this as mapping to HTTP 403,
      // but as with task 4's analogous NOT_ALLOWED case, this repo's
      // installed @medusajs/framework maps NOT_ALLOWED -> 400, not 403 (only
      // MedusaError.Types.FORBIDDEN maps to 403 -- see
      // packages/core/framework/src/http/middlewares/error-handler.ts:67-69,
      // 77-79). This test asserts the real, verified behavior.
      it("returns 400 when deleting another customer's review", async () => {
        const container = getContainer()
        const productModule = container.resolve(Modules.PRODUCT)
        const orderModule = container.resolve(Modules.ORDER)

        const suffix = Date.now()
        const { customer: ownerCustomer, headers: ownerHeaders } =
          await createCustomerWithAuthHeaders(
            container,
            `delete-owner-b-${suffix}@example.com`
          )
        const { headers: otherHeaders } = await createCustomerWithAuthHeaders(
          container,
          `delete-other-${suffix}@example.com`
        )
        const product = await productModule.createProducts({
          title: "Delete mismatch product",
          handle: `delete-mismatch-product-${suffix}`,
        })

        await orderModule.createOrders({
          customer_id: ownerCustomer.id,
          currency_code: "usd",
          items: [
            {
              title: "Test item",
              quantity: 1,
              unit_price: 100,
              product_id: product.id,
            },
          ],
        })

        const created = await api.post(
          "/store/reviews",
          {
            product_id: product.id,
            rating: 5,
            title: "Great product",
            comment: "Loved it",
          },
          ownerHeaders
        )
        const reviewId = created.data.review.id

        const response = await api
          .delete(`/store/reviews/${reviewId}`, otherHeaders)
          .catch((e) => e.response)

        expect(response.status).toBe(400)
      })

      it("returns 404 when the review id does not exist", async () => {
        const container = getContainer()
        const suffix = Date.now()
        const { headers } = await createCustomerWithAuthHeaders(
          container,
          `delete-missing-${suffix}@example.com`
        )

        const response = await api
          .delete("/store/reviews/review_does_not_exist", headers)
          .catch((e) => e.response)

        expect(response.status).toBe(404)
      })
    })

    // Creates a real pending review the long way (customer + order +
    // POST /store/reviews) so admin-facing tests exercise the real review
    // row, not a module-service shortcut. Returns the customer's auth
    // headers and product too, since some callers need to resubmit as the
    // same customer for the same product, or need the order id to cancel
    // it later.
    const createPendingReview = async (
      container: MedusaContainer,
      suffix: string | number
    ) => {
      const productModule = container.resolve(Modules.PRODUCT)
      const orderModule = container.resolve(Modules.ORDER)

      const { customer, headers } = await createCustomerWithAuthHeaders(
        container,
        `admin-moderation-${suffix}@example.com`
      )
      const product = await productModule.createProducts({
        title: "Admin moderation product",
        handle: `admin-moderation-product-${suffix}`,
      })

      const order = await orderModule.createOrders({
        customer_id: customer.id,
        currency_code: "usd",
        items: [
          {
            title: "Test item",
            quantity: 1,
            unit_price: 100,
            product_id: product.id,
          },
        ],
      })

      const created = await api.post(
        "/store/reviews",
        {
          product_id: product.id,
          rating: 5,
          title: "Great product",
          comment: "Loved it",
        },
        headers
      )

      return { review: created.data.review, customer, product, order, headers }
    }

    describe("POST /admin/reviews/:id/approve and /reject", () => {
      it("approves a pending review", async () => {
        const container = getContainer()
        const adminHeaders = { headers: { authorization: "" } }
        await createAdminUser(container, adminHeaders)

        const { review } = await createPendingReview(container, Date.now())

        const response = await api.post(
          `/admin/reviews/${review.id}/approve`,
          {},
          adminHeaders
        )

        expect(response.status).toBe(200)
        expect(response.data.review.id).toBe(review.id)
        expect(response.data.review.status).toBe("approved")
      })

      it("rejects a pending review", async () => {
        const container = getContainer()
        const adminHeaders = { headers: { authorization: "" } }
        await createAdminUser(container, adminHeaders)

        const { review } = await createPendingReview(container, Date.now())

        const response = await api.post(
          `/admin/reviews/${review.id}/reject`,
          {},
          adminHeaders
        )

        expect(response.status).toBe(200)
        expect(response.data.review.id).toBe(review.id)
        expect(response.data.review.status).toBe("rejected")
      })

      it("is a no-op success when approving an already-approved review", async () => {
        const container = getContainer()
        const adminHeaders = { headers: { authorization: "" } }
        await createAdminUser(container, adminHeaders)

        const { review } = await createPendingReview(container, Date.now())

        const first = await api.post(
          `/admin/reviews/${review.id}/approve`,
          {},
          adminHeaders
        )
        expect(first.status).toBe(200)
        expect(first.data.review.status).toBe("approved")

        const second = await api.post(
          `/admin/reviews/${review.id}/approve`,
          {},
          adminHeaders
        )
        expect(second.status).toBe(200)
        expect(second.data.review.status).toBe("approved")
      })

      it("returns 404 when approving a review id that does not exist", async () => {
        const container = getContainer()
        const adminHeaders = { headers: { authorization: "" } }
        await createAdminUser(container, adminHeaders)

        const response = await api
          .post(
            "/admin/reviews/review_does_not_exist/approve",
            {},
            adminHeaders
          )
          .catch((e) => e.response)

        expect(response.status).toBe(404)
      })

      it("resets an approved review back to pending when the customer edits it", async () => {
        const container = getContainer()
        const adminHeaders = { headers: { authorization: "" } }
        await createAdminUser(container, adminHeaders)

        const { review, product, headers } = await createPendingReview(
          container,
          Date.now()
        )

        const approved = await api.post(
          `/admin/reviews/${review.id}/approve`,
          {},
          adminHeaders
        )
        expect(approved.data.review.status).toBe("approved")

        const resubmitted = await api.post(
          "/store/reviews",
          {
            product_id: product.id,
            rating: 2,
            title: "Changed my mind",
            comment: "Not as good as I thought",
          },
          headers
        )

        expect(resubmitted.status).toBe(200)
        expect(resubmitted.data.review.id).toBe(review.id)
        expect(resubmitted.data.review.status).toBe("pending")
      })
    })

    describe("GET /admin/reviews", () => {
      it("lists reviews with product and customer details", async () => {
        const container = getContainer()
        const adminHeaders = { headers: { authorization: "" } }
        await createAdminUser(container, adminHeaders)

        const { review, product, customer } = await createPendingReview(
          container,
          Date.now()
        )

        const response = await api.get(
          `/admin/reviews?product_id=${product.id}&limit=100`,
          adminHeaders
        )

        expect(response.status).toBe(200)
        expect(response.data.count).toBe(1)

        const found = response.data.reviews.find(
          (r: any) => r.id === review.id
        )
        expect(found).toMatchObject({
          id: review.id,
          rating: 5,
          title: "Great product",
          comment: "Loved it",
          status: "pending",
          product: { id: product.id, title: product.title },
          customer: { id: customer.id, email: customer.email },
        })
        expect(found.created_at).toBeDefined()
      })

      it("filters by status", async () => {
        const container = getContainer()
        const adminHeaders = { headers: { authorization: "" } }
        await createAdminUser(container, adminHeaders)

        const suffix = Date.now()
        const pending = await createPendingReview(container, `${suffix}-a`)
        const toApprove = await createPendingReview(container, `${suffix}-b`)

        await api.post(
          `/admin/reviews/${toApprove.review.id}/approve`,
          {},
          adminHeaders
        )

        const response = await api.get(
          "/admin/reviews?status=approved&limit=200",
          adminHeaders
        )

        expect(response.status).toBe(200)
        const ids = response.data.reviews.map((r: any) => r.id)
        expect(ids).toContain(toApprove.review.id)
        expect(ids).not.toContain(pending.review.id)
        expect(
          response.data.reviews.every((r: any) => r.status === "approved")
        ).toBe(true)
      })

      it("filters by product_id", async () => {
        const container = getContainer()
        const adminHeaders = { headers: { authorization: "" } }
        await createAdminUser(container, adminHeaders)

        const suffix = Date.now()
        const forProductA = await createPendingReview(container, `${suffix}-a`)
        await createPendingReview(container, `${suffix}-b`)

        const response = await api.get(
          `/admin/reviews?product_id=${forProductA.product.id}`,
          adminHeaders
        )

        expect(response.status).toBe(200)
        expect(response.data.count).toBe(1)
        expect(response.data.reviews).toHaveLength(1)
        expect(response.data.reviews[0].id).toBe(forProductA.review.id)
        expect(response.data.reviews[0].product.id).toBe(
          forProductA.product.id
        )
      })

      it("paginates with offset/limit", async () => {
        const container = getContainer()
        const adminHeaders = { headers: { authorization: "" } }
        await createAdminUser(container, adminHeaders)

        const productModule = container.resolve(Modules.PRODUCT)
        const orderModule = container.resolve(Modules.ORDER)

        const suffix = Date.now()
        const product = await productModule.createProducts({
          title: "Pagination test product",
          handle: `pagination-test-product-${suffix}`,
        })

        for (let i = 0; i < 3; i++) {
          const { customer, headers } = await createCustomerWithAuthHeaders(
            container,
            `pagination-${suffix}-${i}@example.com`
          )
          await orderModule.createOrders({
            customer_id: customer.id,
            currency_code: "usd",
            items: [
              {
                title: "Test item",
                quantity: 1,
                unit_price: 100,
                product_id: product.id,
              },
            ],
          })
          await api.post(
            "/store/reviews",
            {
              product_id: product.id,
              rating: 5,
              title: `Review ${i}`,
              comment: "Loved it",
            },
            headers
          )
        }

        const response = await api.get(
          `/admin/reviews?product_id=${product.id}&limit=2&offset=1`,
          adminHeaders
        )

        expect(response.status).toBe(200)
        expect(response.data.reviews).toHaveLength(2)
        // count must reflect the filtered total (3), not the page size (2).
        expect(response.data.count).toBe(3)
        expect(response.data.offset).toBe(1)
        expect(response.data.limit).toBe(2)
      })

      it("still returns a review whose order was canceled after the review was created", async () => {
        const container = getContainer()
        const adminHeaders = { headers: { authorization: "" } }
        await createAdminUser(container, adminHeaders)

        const { review, product, order } = await createPendingReview(
          container,
          Date.now()
        )

        // Cancel the order for real, via the same admin order-cancel route
        // used elsewhere in this suite (e.g.
        // fulfillment-queue.spec.ts), rather than mutating order.status
        // directly, so this exercises the real cancellation workflow.
        const cancelResponse = await api.post(
          `/admin/orders/${order.id}/cancel`,
          {},
          adminHeaders
        )
        expect(cancelResponse.status).toBe(200)

        const response = await api.get(
          `/admin/reviews?product_id=${product.id}`,
          adminHeaders
        )

        expect(response.status).toBe(200)
        const found = response.data.reviews.find(
          (r: any) => r.id === review.id
        )
        expect(found).toMatchObject({
          id: review.id,
          status: "pending",
          rating: 5,
          title: "Great product",
          comment: "Loved it",
        })
      })
    })
  },
})
