import { Metadata } from "next"
import { notFound } from "next/navigation"

import { getRegion } from "@lib/data/regions"
import { parseView } from "@modules/store/components/store-hits/view-state"
import StoreTemplate from "@modules/store/templates"

export const metadata: Metadata = {
  title: "Store",
  description: "Explore all of our products.",
}

export default async function StorePage(props: {
  params: Promise<{ countryCode: string }>
  searchParams: Promise<{ view?: string | string[] }>
}) {
  const { countryCode } = await props.params
  const searchParams = await props.searchParams
  const region = await getRegion(countryCode)

  if (!region) {
    notFound()
  }

  return (
    <StoreTemplate
      currencyCode={region.currency_code}
      initialView={parseView(searchParams.view)}
    />
  )
}
