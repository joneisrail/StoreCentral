import type { Hit } from "instantsearch.js"
import type { HitPricing } from "./components/store-hits/price"

export type CatalogHit = Hit<
  {
    title: string | null
    handle: string | null
    thumbnail: string | null
    created_at?: string | null
    in_stock?: boolean | null
    single_variant_id?: string | null
    brand?: string[]
  } & HitPricing
>
