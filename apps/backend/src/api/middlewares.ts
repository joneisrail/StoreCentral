import { authenticate, configureStoreSearch, defineMiddlewares } from '@medusajs/framework/http'
import { invoiceMiddlewares } from './admin/invoices/middlewares'
import { paymentMiddlewares } from './admin/supplier-payments/middlewares'
import { expenseMiddlewares } from './admin/expenses/middlewares'
import { supplierBalanceMiddlewares } from './admin/supplier-balances/middlewares'
import { salesReportMiddlewares } from './admin/sales-report/middlewares'
import { profitReportMiddlewares } from './admin/profit-report/middlewares'
import { purchaseMiddlewares } from './admin/purchases/middlewares'
import { supplierOfferMiddlewares } from './admin/supplier-offers/middlewares'
import { supplierMiddlewares } from './admin/suppliers/middlewares'
import { marketplaceConnectionMiddlewares } from './admin/marketplace-connections/middlewares'
import { guardSalesChannelDelete } from './admin/sales-channels/guard'
import { reviewMiddlewares } from './store/reviews/middlewares'

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
      matcher: '/store/reviews*',
      middlewares: [authenticate('customer', ['session', 'bearer'])],
    },
    ...reviewMiddlewares,
    ...supplierMiddlewares,
    ...supplierOfferMiddlewares,
    ...purchaseMiddlewares,
    ...invoiceMiddlewares,
    ...paymentMiddlewares,
    ...expenseMiddlewares,
    ...supplierBalanceMiddlewares,
    ...salesReportMiddlewares,
    ...profitReportMiddlewares,
    ...marketplaceConnectionMiddlewares,
    {
      method: ['DELETE'],
      matcher: '/admin/sales-channels/:id',
      middlewares: [guardSalesChannelDelete],
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
