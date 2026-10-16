import { configureStoreSearch, defineMiddlewares } from '@medusajs/framework/http'

// The product index declares filterable `status` and `sales_channel_ids`, so
// the route narrows it to published products in the key's sales channels.
export default defineMiddlewares({
  routes: [
    {
      method: ['POST'],
      matcher: '/store/search',
      middlewares: [
        configureStoreSearch({
          allowed_indexes: {
            product: true,
          },
        }),
      ],
    },
    {
      // The EasyPost webhook route verifies the `X-Hmac-Signature` header
      // against the exact raw request bytes, so the JSON bodyparser must
      // preserve them on `req.rawBody` for this route specifically (it does
      // not by default -- see packages/medusa/src/api/hooks/payment's own
      // use of this same config for the built-in payment webhook route).
      method: ['POST'],
      matcher: '/webhooks/easypost',
      bodyParser: { preserveRawBody: true },
    },
  ],
})
