# Custom Workflows

A workflow is a series of queries and actions that complete a task.

The workflow is created in a TypeScript or JavaScript file under the `src/workflows` directory.

> Learn more about workflows in [this documentation](https://docs.medusajs.com/learn/fundamentals/workflows).

For example:

```ts
import {
  createStep,
  createWorkflow,
  WorkflowResponse,
  StepResponse,
} from "@medusajs/framework/workflows-sdk"

const step1 = createStep("step-1", async () => {
  return new StepResponse(`Hello from step one!`)
})

type WorkflowInput = {
  name: string
}

const step2 = createStep(
  "step-2",
  async ({ name }: WorkflowInput) => {
    return new StepResponse(`Hello ${name} from step two!`)
  }
)

type WorkflowOutput = {
  message1: string
  message2: string
}

const helloWorldWorkflow = createWorkflow(
  "hello-world",
  (input: WorkflowInput) => {
    const greeting1 = step1()
    const greeting2 = step2(input)
    
    return new WorkflowResponse({
      message1: greeting1,
      message2: greeting2
    })
  }
)

export default helloWorldWorkflow
```

## Execute Workflow

You can execute the workflow from other resources, such as API routes, scheduled jobs, or subscribers.

For example, to execute the workflow in an API route:

```ts
import type {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import myWorkflow from "../../../workflows/hello-world"

export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const { result } = await myWorkflow(req.scope)
    .run({
      input: {
        name: req.query.name as string,
      },
    })

  res.send(result)
}
```

## Channel pricing and inventory workflows

- `update-channel-offer`: manual grid edit of one channel's price and/or stock; emits `channel-offer.changed` (`manual: true`) only for a real change.
- `apply-order-to-channel-stock`: applies a placed or canceled order to channel stock (idempotent per order line). Run by the `channel-stock-orders` subscriber.
- `trim-channel-stock`: lowers channel stock when it exceeds the available total. Run by the `channel-stock-trim` subscriber.
- `ensure-channel-offers`: creates missing offer rows for a variant or sales channel. Run by the `channel-offers-ensure` subscriber.
- `request-channel-sync`: the sync icon; emits `channel-offer.changed` with `kind: "both"` and `force: true`.
- `update-channel-stock-settings`: writes `store.metadata.share_stock_after_sale`.
- `receive-purchase-goods` (existing) gains `splitReceivedStockAcrossChannelsStep`, which splits the received quantity across the channels and emits `channel-offer.changed` for each affected channel.
