# Stock split (one-time, owner-run)

The channel stock feature gives every sales channel its own stock number for each variant. Variants stocked before the feature existed have all their stock unallocated. `apps/backend/src/scripts/split-existing-stock.ts` splits that stock across the channels once.

Agents never run this script. The owner runs it, on the real database, after reading this page.

## When to run it

1. After the channel-offers migration has been applied to the real database (the `channel_offer` and `channel_stock_movement` tables must exist). See [migration-check.md](./migration-check.md) for how the migration is verified first.
2. In a quiet period: no orders being placed and no stock edits in flight.
3. Before any purchase receipt is received and before anyone edits the Channel stock & pricing grid. A variant that already has any nonzero channel stock is skipped, so work done in the grid first would leave that variant out of the split.

## Dry run (default)

Run from `apps/backend`:

```
npx medusa exec ./src/scripts/split-existing-stock.ts
```

With no argument the script is a dry run and writes nothing. It logs counts only (no product names, no quantities per variant):

| Log line | Meaning |
| --- | --- |
| `split-existing-stock: N channels (dry run, nothing will be written)` | Number of sales channels found. If it is 0 the script stops. |
| `batch B checked X, split Y, skipped Z` | Per batch of 500 variants: how many were looked at, how many would be split, how many would be left alone. |
| `done (dry run, nothing written): checked X, would split Y, skipped Z` | The totals. |
| `to apply run: npx medusa exec ./src/scripts/split-existing-stock.ts apply` | Reminder of the apply command. |

A variant is skipped when it has nothing available, has any nonzero channel stock already, already has an `initial-split:<variant_id>` movement, or does not track inventory. The dry run does not re-read live stock under a lock, so the apply run can skip a few more than the dry run reports. An earlier dry run reported 20 variants across 5 channels would be split; treat any number as indicative, not guaranteed, and read the fresh output.

## Apply

```
npx medusa exec ./src/scripts/split-existing-stock.ts apply
```

The word must be positional and exactly `apply`. `medusa exec` swallows flags such as `--dry-run` or `--apply`, so they never reach the script: anything other than the exact word `apply` leaves it a dry run. The final line reads `done: checked X, split Y, skipped Z` (no "dry run").

## What it does

- Takes each variant's available stock (stock on hand less reservations, from the inventory module) and splits it equally across all sales channels. The channels are ordered by creation time (oldest first). The remainder goes one unit each to the earliest-created channels: 10 units over 3 channels gives 4, 3, 3.
- Re-reads the variant's live available stock while holding a per-variant lock, and uses the lower of the bulk figure and the live figure. The split never exceeds available stock.
- Creates the channel offer rows if missing, writes the per-channel stock, then records one `rebalance` stock movement per channel that received units, with the reference `initial-split:<variant_id>`.
- Is idempotent: a variant that already has an `initial-split:<variant_id>` movement, or any nonzero channel stock, is left alone.

## What it does not do

- It does not push anything to a marketplace.
- It emits no events (no `channel-offer.changed`).
- It does not change prices or any other offer field.
- It does not touch variants that do not track inventory.

## Verify afterwards

Open the Channel stock & pricing grid in the admin. For split variants:

- the unallocated figure is 0;
- the channel columns add up to the variant's total stock.

Also compare the apply run's `split` count with the dry run's `would split` count; a small difference is explained by skips under the lock.

## If it is interrupted

It is safe to run the apply command again. For each variant the script writes stock first and the movements second. If it stops between the two, the variant has nonzero channel stock and a re-run skips it (it will show as skipped, and the stock itself is correct; only its `initial-split` movement may be missing). Variants not yet reached are split normally by the re-run.
