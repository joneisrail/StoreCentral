import type { HeroContent } from "@lib/content/homepage"
import { Heading, Text } from "@modules/common/components/ui"
import LocalizedClientLink from "@modules/common/components/localized-client-link"

import HeroImage from "./hero-image"

const Hero = ({ content }: { content: HeroContent }) => {
  const { eyebrow, headline, subheadline, cta, image } = content

  return (
    <section
      data-testid="home-hero"
      className="relative w-full overflow-hidden border-b border-line bg-gradient-to-b from-ivory to-line min-h-[420px] aspect-[4/5] small:aspect-[16/9] small:min-h-[480px]"
    >
      {image ? <HeroImage image={image} /> : null}
      <div
        className={`relative z-10 flex h-full min-h-[inherit] w-full flex-col items-center justify-center gap-4 px-6 py-16 text-center ${
          image ? "text-ivory" : "text-charcoal"
        }`}
      >
        {eyebrow ? (
          <Text
            as="span"
            className={`text-sm uppercase tracking-[0.2em] ${
              image ? "text-ivory" : "text-gold-deep"
            }`}
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
            className={`mt-2 ${image ? "bg-ivory text-charcoal" : "bg-charcoal text-ivory"} inline-flex min-h-[44px] items-center justify-center rounded-base px-6 font-sans font-medium transition-colors hover:bg-gold-deep hover:text-paper motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-deep focus-visible:ring-offset-2 focus-visible:ring-offset-ivory`}
          >
            {cta.label}
          </LocalizedClientLink>
        ) : null}
      </div>
    </section>
  )
}

export default Hero
