import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/utils"
import upsertReviewWorkflow from "../../src/workflows/upsert-review"

jest.setTimeout(60000)

medusaIntegrationTestRunner({
  testSuite: ({ getContainer }) => {
    describe("upsertReviewWorkflow", () => {
      it("creates a review and links on first submission, then updates the same review without recreating links on resubmission", async () => {
        const container = getContainer()

        const customerModule = container.resolve(Modules.CUSTOMER)
        const productModule = container.resolve(Modules.PRODUCT)
        const orderModule = container.resolve(Modules.ORDER)
        const query = container.resolve(ContainerRegistrationKeys.QUERY)
        const linkModule = container.resolve(ContainerRegistrationKeys.LINK)

        const suffix = Date.now()

        const customer = await customerModule.createCustomers({
          email: `reviewer-${suffix}@example.com`,
        })

        const product = await productModule.createProducts({
          title: "Workflow test product",
          handle: `workflow-test-product-${suffix}`,
        })

        // Counts the raw pivot rows for this review's product/customer links
        // directly, rather than relying on a query.graph join, because
        // Medusa's link duplicate-prevention (modules-sdk's Link.create())
        // only rejects a link whose OTHER side differs from an existing row
        // -- it does not reject a second, identical (review_id, product_id)
        // pivot row. A joined query would still read back the correct
        // product/customer even if `when(...).then(...)` silently ran
        // createRemoteLinkStep twice, so only a direct row count can tell
        // "the gate worked" apart from "the gate ran twice with identical data".
        const countReviewLinks = async (reviewId: string) => {
          const productLinks = await linkModule.list({
            review: { review_id: reviewId },
            [Modules.PRODUCT]: { product_id: product.id },
          })
          const customerLinks = await linkModule.list({
            review: { review_id: reviewId },
            [Modules.CUSTOMER]: { customer_id: customer.id },
          })
          return {
            productLinkCount: productLinks.length,
            customerLinkCount: customerLinks.length,
          }
        }

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

        const { result: firstResult } = await upsertReviewWorkflow(
          container
        ).run({
          input: {
            product_id: product.id,
            customer_id: customer.id,
            rating: 4,
            title: "Good",
            comment: "Works well",
          },
        })

        expect(firstResult.review.status).toBe("pending")
        expect(firstResult.review.product_id).toBe(product.id)
        expect(firstResult.review.customer_id).toBe(customer.id)

        const { data: afterFirst } = await query.graph({
          entity: "review",
          fields: ["id", "product.id", "customer.id"],
          filters: { id: firstResult.review.id },
        })

        expect(afterFirst).toHaveLength(1)
        expect(afterFirst[0].product?.id).toBe(product.id)
        expect(afterFirst[0].customer?.id).toBe(customer.id)

        const countsAfterFirst = await countReviewLinks(firstResult.review.id)
        expect(countsAfterFirst.productLinkCount).toBe(1)
        expect(countsAfterFirst.customerLinkCount).toBe(1)

        const { result: secondResult } = await upsertReviewWorkflow(
          container
        ).run({
          input: {
            product_id: product.id,
            customer_id: customer.id,
            rating: 2,
            title: "Changed my mind",
            comment: "Not as good as I thought",
          },
        })

        expect(secondResult.review.id).toBe(firstResult.review.id)
        expect(secondResult.review.rating).toBe(2)
        expect(secondResult.review.title).toBe("Changed my mind")
        expect(secondResult.review.comment).toBe("Not as good as I thought")
        expect(secondResult.review.status).toBe("pending")

        const { data: afterSecond } = await query.graph({
          entity: "review",
          fields: ["id", "product.id", "customer.id"],
          filters: { id: firstResult.review.id },
        })

        expect(afterSecond).toHaveLength(1)
        expect(afterSecond[0].product?.id).toBe(product.id)
        expect(afterSecond[0].customer?.id).toBe(customer.id)

        // The assertion that actually catches a broken `when(...).then(...)`
        // gate: if the update path silently re-ran createRemoteLinkStep, the
        // joined query above would still pass (it reads the same product and
        // customer back either way), but the pivot row count would be 2.
        const countsAfterSecond = await countReviewLinks(
          secondResult.review.id
        )
        expect(countsAfterSecond.productLinkCount).toBe(1)
        expect(countsAfterSecond.customerLinkCount).toBe(1)
      })
    })
  },
})
