import { Metadata } from "next"
import { notFound, redirect } from "next/navigation"

import { getRegion } from "@lib/data/regions"
import { getPopularSearches } from "@lib/data/search-insights"
import { getStoreName } from "@lib/util/store-name"
import { normalizeQuery } from "@modules/search/templates/search-query"
import SearchResults from "@modules/search/templates/search-results"
import { parseView } from "@modules/store/components/store-hits/view-state"

type SearchParams = { q?: string | string[]; view?: string | string[] }

export async function generateMetadata(props: {
  searchParams: Promise<SearchParams>
}): Promise<Metadata> {
  const q = normalizeQuery((await props.searchParams).q)

  return {
    title: q ? `Results for “${q}” | ${getStoreName()}` : getStoreName(),
    robots: { index: false, follow: true },
  }
}

export default async function SearchPage(props: {
  params: Promise<{ countryCode: string }>
  searchParams: Promise<SearchParams>
}) {
  const { countryCode } = await props.params
  const searchParams = await props.searchParams
  const query = normalizeQuery(searchParams.q)

  if (!query) {
    redirect(`/${countryCode}/store`)
  }

  const region = await getRegion(countryCode)

  if (!region) {
    notFound()
  }

  const popularSearches = await getPopularSearches()

  return (
    <SearchResults
      key={query}
      query={query}
      currencyCode={region.currency_code}
      popularSearches={popularSearches}
      initialView={parseView(searchParams.view)}
    />
  )
}
