import type { EditorialBlock } from "@lib/content/homepage"
import { Heading, Text } from "@modules/common/components/ui"
import SafeImage from "@modules/common/components/safe-image"
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
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-soft">
                <SafeImage
                  src={block.image.src}
                  alt={block.image.alt}
                  sizes="(min-width: 1440px) 680px, (min-width: 1024px) 50vw, 100vw"
                />
              </div>
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
