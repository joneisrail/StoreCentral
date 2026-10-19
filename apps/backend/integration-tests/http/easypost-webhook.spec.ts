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

      it("only updates the fulfillment matching the tracking code, leaving an unrelated fulfillment with a different tracking code untouched (Review Focus: lookup discriminates, doesn't just pick the only row)", async () => {
        const container = getContainer()
        const fulfillmentModule = container.resolve(Modules.FULFILLMENT)
        const query = container.resolve(ContainerRegistrationKeys.QUERY)

        const targetTrackingCode = "EZ_DISCRIMINATING_TARGET_0001"
        const otherTrackingCode = "EZ_DISCRIMINATING_OTHER_0002"

        const createFixtureFulfillment = async (trackingCode: string) => {
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

          return created.id
        }

        // Two fulfillments exist at once -- the point of this test is to
        // prove the `data.easypost_tracking_code` filter actually
        // discriminates between them, rather than the lookup silently
        // no-op'ing (an unsupported/ignored filter key) and the route
        // happening to act on whichever row it got back anyway.
        const targetId = await createFixtureFulfillment(targetTrackingCode)
        const otherId = await createFixtureFulfillment(otherTrackingCode)

        const rawBody = JSON.stringify({
          description: "tracker.updated",
          result: { tracking_code: targetTrackingCode, status: "delivered" },
        })

        const res = await postWebhook(rawBody, signRawBody(rawBody, WEBHOOK_SECRET))

        expect(res.status).toBe(200)

        const { data: fulfillments } = await query.graph({
          entity: "fulfillment",
          fields: ["id", "delivered_at"],
          filters: { id: [targetId, otherId] },
        })

        const target = fulfillments.find((f) => f.id === targetId)
        const other = fulfillments.find((f) => f.id === otherId)

        expect(target?.delivered_at).not.toBeNull()
        expect(other?.delivered_at).toBeNull()
      })

      describe("in-transit statuses (createShipmentWorkflow)", () => {
        // createShipmentWorkflow requires the fulfillment to have a real
        // shipping option, so -- unlike the delivered tests above -- these
        // fixtures attach one. Without it the route skips shipping for every
        // status and a "pre_transit doesn't ship" assertion would pass
        // vacuously; the in_transit control below proves it can ship.
        const createShippableFulfillment = async (trackingCode: string) => {
          const container = getContainer()
          const fulfillmentModule = container.resolve(Modules.FULFILLMENT)

          const [shippingProfile] =
            await fulfillmentModule.createShippingProfiles([
              { name: `Profile ${trackingCode}`, type: "default" },
            ])
          const fulfillmentSet = await fulfillmentModule.createFulfillmentSets(
            {
              name: `Set ${trackingCode}`,
              type: "shipping",
              service_zones: [{ name: `Zone ${trackingCode}` }],
            }
          )
          const shippingOption = await fulfillmentModule.createShippingOptions(
            {
              name: `Option ${trackingCode}`,
              service_zone_id: fulfillmentSet.service_zones[0].id,
              shipping_profile_id: shippingProfile.id,
              provider_id: "manual_manual",
              price_type: "flat",
              type: {
                label: "Standard",
                description: "Standard shipping",
                code: "standard",
              },
              data: {},
            }
          )

          const created = await fulfillmentModule.createFulfillment({
            location_id: "sloc_test_location",
            provider_id: "manual_manual",
            shipping_option_id: shippingOption.id,
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

          return created.id
        }

        const getShippedAt = async (id: string) => {
          const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
          const { data: fulfillments } = await query.graph({
            entity: "fulfillment",
            fields: ["id", "shipped_at"],
            filters: { id },
          })
          return fulfillments[0]?.shipped_at
        }

        it("does NOT mark the fulfillment shipped on pre_transit (EasyPost emits it on label purchase, before the carrier has the package)", async () => {
          const trackingCode = "EZ_PRE_TRANSIT_0001"
          const id = await createShippableFulfillment(trackingCode)

          const rawBody = JSON.stringify({
            description: "tracker.updated",
            result: { tracking_code: trackingCode, status: "pre_transit" },
          })

          const res = await postWebhook(rawBody, signRawBody(rawBody, WEBHOOK_SECRET))

          expect(res.status).toBe(200)
          expect(await getShippedAt(id)).toBeNull()
        })

        it("marks the fulfillment shipped on in_transit (control: the same fixture CAN be shipped)", async () => {
          const trackingCode = "EZ_IN_TRANSIT_0001"
          const id = await createShippableFulfillment(trackingCode)

          const rawBody = JSON.stringify({
            description: "tracker.updated",
            result: { tracking_code: trackingCode, status: "in_transit" },
          })

          const res = await postWebhook(rawBody, signRawBody(rawBody, WEBHOOK_SECRET))

          expect(res.status).toBe(200)
          expect(await getShippedAt(id)).not.toBeNull()
        })
      })

      it("returns 401, not an unhandled exception, when EASYPOST_API_KEY is empty (regression: EasyPostClient construction must not throw outside the signature fail-closed path)", async () => {
        const originalApiKey = process.env.EASYPOST_API_KEY

        // The route constructs an `EasyPostClient` to call its pure-crypto
        // `verifyWebhookSignature` method. The underlying `@easypost/api` SDK
        // throws synchronously (`MissingParameterError`) when constructed
        // with a falsy key and no `useProxy` option. This test proves that
        // an empty/missing API key still results in a clean 401, not an
        // unhandled exception -- even though the signature below is
        // correctly computed from the webhook secret (which is unrelated to
        // the API key), construction failing means authenticity could not
        // be verified, so the route must fail closed the same way it would
        // for a bad signature.
        process.env.EASYPOST_API_KEY = ""

        try {
          const rawBody = JSON.stringify({
            description: "tracker.updated",
            result: {
              tracking_code: "EZ_EMPTY_API_KEY_TEST",
              status: "in_transit",
            },
          })

          const res = await postWebhook(rawBody, signRawBody(rawBody, WEBHOOK_SECRET))

          expect(res.status).toBe(401)
        } finally {
          process.env.EASYPOST_API_KEY = originalApiKey
        }
      })
    })
  },
})
