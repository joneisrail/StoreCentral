import crypto from "crypto"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

jest.setTimeout(60000)

const WEBHOOK_SECRET = "test-easypost-webhook-secret"

// Replicates the HMAC-SHA256 scheme documented in
// @dtc/fulfillment-easypost's EasyPostClient.verifyWebhookSignature: the hex
// digest of HMAC-SHA256(secret, rawBody), prefixed with "hmac-sha256-hex=".
function signRawBody(rawBody: string, secret: string): string {
  const digest = crypto
    .createHmac("sha256", Buffer.from(secret.normalize("NFKD"), "utf8"))
    .update(Buffer.from(rawBody, "utf8"))
    .digest("hex")
  return `hmac-sha256-hex=${digest}`
}

medusaIntegrationTestRunner({
  env: {
    EASYPOST_WEBHOOK_SECRET: WEBHOOK_SECRET,
  },
  testSuite: ({ api, getContainer }) => {
    describe("POST /webhooks/easypost", () => {
      const postWebhook = (rawBody: string, signature: string) =>
        api.post("/webhooks/easypost", rawBody, {
          headers: {
            "Content-Type": "application/json",
            "X-Hmac-Signature": signature,
          },
          validateStatus: () => true,
        })

      it("rejects a webhook with an invalid signature before touching any data", async () => {
        const rawBody = JSON.stringify({
          description: "tracker.updated",
          result: { tracking_code: "EZ_WRONG_SIG_TEST", status: "in_transit" },
        })

        const res = await postWebhook(rawBody, "hmac-sha256-hex=wrong")

        expect(res.status).toBe(401)
      })

      it("returns 200 and does nothing harmful for an unknown tracking code", async () => {
        const rawBody = JSON.stringify({
          description: "tracker.updated",
          result: { tracking_code: "UNKNOWN_TRACKING_CODE_123", status: "in_transit" },
        })

        const res = await postWebhook(rawBody, signRawBody(rawBody, WEBHOOK_SECRET))

        expect(res.status).toBe(200)
      })

      it("returns 400, not a crash, for a malformed body", async () => {
        const rawBody = "not json"

        const res = await postWebhook(rawBody, signRawBody(rawBody, WEBHOOK_SECRET))

        expect(res.status).toBe(400)
      })

      it("updates the real fulfillment's status when a valid webhook matches a known tracking code (Review Focus: core happy path)", async () => {
        const container = getContainer()
        const fulfillmentModule = container.resolve(Modules.FULFILLMENT)
        const query = container.resolve(ContainerRegistrationKeys.QUERY)

        const trackingCode = "EZ_REAL_TRACKING_0001"

        // Create a real fulfillment row via the real module service. Using
        // the manual provider (not easypost_easypost) deliberately: the real
        // EasyPost provider's own createFulfillment requires a persisted,
        // unbought shipment/rate id and would call the live EasyPost API --
        // out of scope for this fixture. The webhook route's lookup only
        // keys on `data.easypost_tracking_code`, which is independent of
        // which provider actually created the row.
        const created = await fulfillmentModule.createFulfillment({
          location_id: "sloc_test_location",
          provider_id: "manual_manual",
          delivery_address: {
            first_name: "Jane",
            last_name: "Doe",
            address_1: "123 Main St",
            city: "Portland",
            country_code: "us",
            province: "or",
            postal_code: "97201",
          },
          items: [
            {
              title: "Test item",
              sku: "TEST-SKU",
              quantity: 1,
              barcode: "TEST-BARCODE",
            },
          ],
        })

        await fulfillmentModule.updateFulfillment(created.id, {
          data: { easypost_tracking_code: trackingCode },
        })

        const rawBody = JSON.stringify({
          description: "tracker.updated",
          result: { tracking_code: trackingCode, status: "delivered" },
        })

        const res = await postWebhook(rawBody, signRawBody(rawBody, WEBHOOK_SECRET))

        expect(res.status).toBe(200)

        const { data: fulfillments } = await query.graph({
          entity: "fulfillment",
          fields: ["id", "delivered_at"],
          filters: { id: created.id },
        })

        expect(fulfillments).toHaveLength(1)
        expect(fulfillments[0].delivered_at).not.toBeNull()
      })
    })
  },
})
