import { Suspense } from "react"

import { listLocales } from "@lib/data/locales"
import { getLocale } from "@lib/data/locale-actions"
import { getRegion } from "@lib/data/regions"
import {
  getPopularSearches,
  getTrendingProducts,
} from "@lib/data/search-insights"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import CartButton from "@modules/layout/components/cart-button"
import Search from "@modules/layout/components/search"
import SideMenu from "@modules/layout/components/side-menu"
import { getStoreName } from "@lib/util/store-name"

export default async function Nav({ countryCode }: { countryCode: string }) {
  const [locales, currentLocale, region] = await Promise.all([
    listLocales(),
    getLocale(),
    // Only prices in search results need it; a failure must not break the nav.
    getRegion(countryCode).catch(() => null),
  ])
  // Not awaited: the search overlay shows these sections once they arrive,
  // so a slow insights route never holds up the navbar. Both resolve to null
  // on failure and are cached for 5 minutes server-side.
  const searchInsights = Promise.all([
    getPopularSearches(),
    getTrendingProducts(),
  ]).then(([popular, trending]) => ({ popular, trending }))

  return (
    <div className="sticky top-0 inset-x-0 z-50 group">
      <header className="relative h-16 mx-auto border-b motion-safe:duration-200 bg-ivory border-line">
        <nav className="content-container txt-xsmall-plus text-charcoal flex items-center justify-between w-full h-full text-small-regular">
          <div className="flex-1 basis-0 h-full flex items-center">
            <div className="h-full">
              <SideMenu
                locales={locales}
                currentLocale={currentLocale}
                storeName={getStoreName()}
              />
            </div>
          </div>

          <div className="flex items-center h-full">
            <LocalizedClientLink
              href="/"
              className="font-serif text-xl tracking-wide text-charcoal hover:text-gold-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-deep"
              data-testid="nav-store-link"
            >
              {getStoreName()}
            </LocalizedClientLink>
          </div>

          <div className="flex items-center gap-x-6 h-full flex-1 basis-0 justify-end">
            <Search
              currencyCode={region?.currency_code ?? ""}
              insights={searchInsights}
            />
            <div className="hidden small:flex items-center gap-x-6 h-full">
              <LocalizedClientLink
                className="hover:text-gold-deep flex items-center min-h-[44px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-deep"
                href="/account"
                data-testid="nav-account-link"
              >
                Account
              </LocalizedClientLink>
            </div>
            <Suspense
              fallback={
                <LocalizedClientLink
                  className="hover:text-gold-deep flex items-center gap-2 min-h-[44px]"
                  href="/cart"
                  data-testid="nav-cart-link"
                >
                  Cart (0)
                </LocalizedClientLink>
              }
            >
              <CartButton />
            </Suspense>
          </div>
        </nav>
      </header>
    </div>
  )
}
