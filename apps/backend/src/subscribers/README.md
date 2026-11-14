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
