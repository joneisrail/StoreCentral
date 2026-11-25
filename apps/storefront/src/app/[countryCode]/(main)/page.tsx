import { Metadata } from "next"

import { homepageContent } from "@lib/content/homepage"
import { getStoreName } from "@lib/util/store-name"
import Hero from "@modules/home/components/hero"
import HomeSections from "@modules/home/templates/home-sections"

export function generateMetadata(): Metadata {
  return {
    title: getStoreName(),
    description: homepageContent.description,
  }
}

export default async function Home(props: {
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await props.params

  return (
    <>
      <Hero content={homepageContent.hero} />
      <HomeSections countryCode={countryCode} />
    </>
  )
}
