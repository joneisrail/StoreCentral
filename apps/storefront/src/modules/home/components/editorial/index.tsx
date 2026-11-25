import type { EditorialBlock } from "@lib/content/homepage"
import { Heading, Text } from "@modules/common/components/ui"
import LocalizedClientLink from "@modules/common/components/localized-client-link"

import Reveal from "../reveal"

const Editorial = ({ blocks }: { blocks: EditorialBlock[] }) => {
  if (!blocks.length) {
    return null
  }

  return (
    <Reveal>
      <section className="content-container flex flex-col gap-12 py-12 small:py-24">
        {blocks.map((block) => (
          <article
            key={block.id}
            className="grid min-w-0 grid-cols-1 items-center gap-8 small:grid-cols-2"
          >
            {block.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={block.image.src}
                alt={block.image.alt}
                loading="lazy"
                className="aspect-[4/3] w-full rounded-soft object-cover"
              />
            ) : null}
            <div className="flex min-w-0 flex-col items-start gap-4">
              <Heading level="h2" className="break-words">
                {block.title}
              </Heading>
              <Text className="text-charcoal">{block.text}</Text>
              {block.href ? (
                <LocalizedClientLink
                  href={block.href}
                  className="inline-flex min-h-[44px] items-center rounded-soft font-sans text-charcoal underline underline-offset-4 hover:text-gold-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-deep focus-visible:ring-offset-2 focus-visible:ring-offset-ivory lg:min-h-0"
                >
                  {block.linkLabel ?? "Read more"}
                </LocalizedClientLink>
              ) : null}
            </div>
          </article>
        ))}
      </section>
    </Reveal>
  )
}

export default Editorial
