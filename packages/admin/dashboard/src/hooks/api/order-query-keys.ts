import { queryKeysFactory } from "../../lib/query-key-factory"

// Dependency-free so `orders.tsx`, `order-holds.tsx` and `hold-reason.ts` can
// all import these without creating import cycles.
export const HOLD_TAG_VALUE = "On hold"
export const ORDER_VIEW_COUNTS_QUERY_KEY = "order-view-counts" as const
export const orderHeldIdsQueryKeys = queryKeysFactory("order-held-ids")
export const orderTagsQueryKeys = queryKeysFactory("order-tags" as const)
