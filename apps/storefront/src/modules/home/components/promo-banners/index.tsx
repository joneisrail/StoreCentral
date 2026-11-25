import type { Promo } from "@lib/content/homepage"
import { Heading, Text } from "@modules/common/components/ui"
import LocalizedClientLink from "@modules/common/components/localized-client-link"

import Reveal from "../reveal"

const PromoBanners = ({ promos }: { promos: Promo[] }) => {
  if (!promos.length) {
    return null
  }

  return (
    <Reveal>
      <section className="content-container py-12 small:py-24">
        <ul className="grid grid-cols-1 gap-6 small:grid-cols-2">
          {promos.map((promo) => (
            <li
              key={promo.id}
              className="flex min-w-0 flex-col overflow-hidden rounded-soft border border-line bg-paper"
            >
              {promo.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={promo.image.src}
                  alt={promo.image.alt}
                  loading="lazy"
                  className="aspect-[16/9] w-full object-cover"
                />
              ) : null}
              <div className="flex flex-col items-start gap-3 p-6">
                <Heading level="h2" className="break-words">
                  {promo.title}
                </Heading>
                {promo.text ? (
                  <Text className="text-charcoal">{promo.text}</Text>
                ) : null}
                <LocalizedClientLink
                  href={promo.href}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-base bg-charcoal px-6 font-sans font-medium text-ivory transition-colors hover:bg-gold-deep hover:text-paper motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-deep focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
                >
                  {promo.ctaLabel}
                </LocalizedClientLink>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </Reveal>
  )
}

export default PromoBanners
