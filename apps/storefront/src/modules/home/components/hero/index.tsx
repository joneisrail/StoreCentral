import type { HeroContent } from "@lib/content/homepage"
import { Heading, Text } from "@modules/common/components/ui"
import LocalizedClientLink from "@modules/common/components/localized-client-link"

import HeroFrame from "./hero-frame"

const Hero = ({ content }: { content: HeroContent }) => {
  const { eyebrow, headline, subheadline, cta, image } = content

  return (
    <HeroFrame image={image}>
      <div className="relative z-10 flex h-full min-h-[inherit] w-full flex-col items-center justify-center gap-4 px-6 py-16 text-center text-charcoal group-data-[tone=light]:text-ivory">
        {eyebrow ? (
          <Text
            as="span"
            className="text-sm uppercase tracking-[0.2em]"
          >
            {eyebrow}
          </Text>
        ) : null}
        <Heading
          level="h1"
          className="max-w-3xl break-words text-4xl font-normal leading-tight small:text-6xl"
        >
          {headline}
        </Heading>
        {subheadline ? (
          <Text className="max-w-xl text-lg">{subheadline}</Text>
        ) : null}
        {cta ? (
          <LocalizedClientLink
            href={cta.href}
            className="mt-2 inline-flex min-h-[44px] items-center justify-center rounded-base bg-charcoal px-6 font-sans font-medium text-ivory transition-colors hover:bg-gold-deep hover:text-paper motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-deep focus-visible:ring-offset-2 focus-visible:ring-offset-ivory group-data-[tone=light]:bg-ivory group-data-[tone=light]:text-charcoal group-data-[tone=light]:hover:bg-paper"
          >
            {cta.label}
          </LocalizedClientLink>
        ) : null}
      </div>
    </HeroFrame>
  )
}

export default Hero
