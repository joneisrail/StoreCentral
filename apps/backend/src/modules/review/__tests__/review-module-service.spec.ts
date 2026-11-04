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
        const updated = await service.updateReviews({
          id: review.id,
          status: "approved",
        })
        expect(updated.status).toBe("approved")
      })
    })
  },
})
