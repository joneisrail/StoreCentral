# Custom subscribers

Subscribers handle events emitted in the Medusa application.

> Learn more about Subscribers in [this documentation](https://docs.medusajs.com/learn/fundamentals/events-and-subscribers).

The subscriber is created in a TypeScript or JavaScript file under the `src/subscribers` directory.

For example, create the file `src/subscribers/product-created.ts` with the following content:

```ts
import {
  type SubscriberConfig,
} from "@medusajs/framework"

// subscriber function
export default async function productCreateHandler() {
  console.log("A product was created")
}

// subscriber config
export const config: SubscriberConfig = {
  event: "product.created",
}
```

A subscriber file must export:

- The subscriber function that is an asynchronous function executed whenever the associated event is triggered.
- A configuration object defining the event this subscriber is listening to.

## Subscriber Parameters

A subscriber receives an object having the following properties:

- `event`: An object holding the event's details. It has a `data` property, which is the event's data payload.
- `container`: The Medusa container. Use it to resolve modules' main services and other registered resources.

```ts
import type {
  SubscriberArgs,
  SubscriberConfig,
} from "@medusajs/framework"

export default async function productCreateHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const productId = data.id

  const productModuleService = container.resolve("product")

  const product = await productModuleService.retrieveProduct(productId)

  console.log(`The product ${product.title} was created`)
}

export const config: SubscriberConfig = {
  event: "product.created",
}
```

## seller-hub-sync

`seller-hub-sync.ts` forwards events to Seller Hub (`POST ${SELLER_HUB_WEBHOOK_URL}/webhooks/medusa`, body `{ event, data }`), best-effort: failures are logged (event name only) and never thrown.

- `inventory-level.updated`, `product-variant.updated`: `data` is forwarded unchanged (`{ id }`).
- `shipment.created`: Medusa emits `{ id: <fulfillment id>, no_notification }`. The subscriber resolves the owning order via the `order_fulfillment` link (Query graph) and forwards `data: { id, order_id, no_notification }` (`no_notification` defaults to `false`). If the order cannot be resolved the event is logged and dropped.
- `channel-offer.changed`: see below.

### `channel-offer.changed` and the legacy-forward rule

`channel-offer.changed` is emitted by the update-channel-offer, apply-order-to-channel-stock, receive-purchase-goods, trim-channel-stock and request-channel-sync workflows. It is forwarded as `{ variant_id, sales_channel_id, kind, force, manual? }`:

- `kind` is `"stock"`, `"price"` or `"both"`; a payload with a missing id or another kind is logged and dropped.
- `force` is `true` only for the sync icon (request-channel-sync); anything but `true` is forwarded as `false`.
- `manual: true` is added only when the event came from a manual grid edit.
- The backend always forwards. Seller Hub decides what to push (stock always; price only when `force` or the connection has `auto_sync_price`).

Legacy forward rule: `inventory-level.updated` and `product-variant.updated` are still forwarded unchanged, but only while at least one affected variant has no `channel_offer` rows (so nothing regresses before the one-time split). Variants that have offer rows sync through `channel-offer.changed` instead, so the legacy event is dropped. If the lookup fails, the legacy event is forwarded (fail open).

## Channel offer subscribers

All three are best-effort: they never throw and log only ids.

- `channel-stock-orders.ts`: on `order.placed` and `order.canceled` runs `applyOrderToChannelStockWorkflow` (`mode` `placed` or `canceled`). Idempotent per order line, so a redelivered event changes stock once.
- `channel-offers-ensure.ts`: on `product-variant.created` and `sales-channel.created` runs `ensureChannelOffersWorkflow` so every variant has an offer row for every channel. Idempotent.
- `channel-stock-trim.ts`: on `inventory-level.updated` finds the linked variants and runs `trimChannelStockWorkflow` for each, lowering channel stock when it now exceeds the available total. Our own channel stock writes never change Medusa's total, so this cannot loop.
