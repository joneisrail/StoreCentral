import { notFound } from "next/navigation"
import { ProductCardView } from "@modules/products/components/product-preview"
import DesignSystemDemos from "./demos"
import { isPreviewEnabled } from "./gate"
import { contrastRatio, swatches } from "./swatches"

export const metadata = {
  title: "Design system",
  robots: { index: false, follow: false },
}

const ratio = (a: string, b: string): string =>
  contrastRatio(a, b).toFixed(2)

const longTitle = "Extraordinarily long perfume title ".repeat(9).slice(0, 300)

const typeScale = [
  { label: "Heading 1 (serif, 2rem)", className: "font-serif text-3xl" },
  { label: "Heading 2 (serif, 1.5rem)", className: "font-serif text-2xl" },
  { label: "Heading 3 (serif, 1.25rem)", className: "font-serif text-xl" },
  { label: "Body large (sans, 1.125rem)", className: "font-sans text-lg" },
  { label: "Body (sans, 1rem)", className: "font-sans text-base" },
  { label: "Small (sans, 0.875rem)", className: "font-sans text-sm" },
]

export default function DesignSystemPage() {
  if (!isPreviewEnabled()) {
    notFound()
  }

  const ivory = swatches[0].hex
  const paper = swatches[1].hex

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-12 px-6 py-12 text-charcoal">
      <header>
        <h1 className="font-serif text-3xl">Design system</h1>
        <p className="mt-2 text-sm text-warm-grey">
          Development preview. Fixtures only, not available in production.
        </p>
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="font-serif text-2xl">Colours</h2>
        <ul className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {swatches.map((s) => (
            <li
              key={s.name}
              className="rounded-soft border border-line bg-paper"
            >
              <div
                className="h-16 rounded-t-soft"
                style={{ backgroundColor: s.hex }}
              />
              <div className="p-3 text-sm">
                <p className="font-medium">{s.name}</p>
                <p className="text-warm-grey">{s.hex}</p>
                <p className="mt-1 text-warm-grey">
                  On ivory {ratio(s.hex, ivory)}:1
                </p>
                <p className="text-warm-grey">
                  On paper {ratio(s.hex, paper)}:1
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-serif text-2xl">Type scale</h2>
        <div className="flex flex-col gap-3">
          {typeScale.map((t) => (
            <p key={t.label} className={t.className}>
              {t.label}
            </p>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-serif text-2xl">Product card</h2>
        <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
          <ProductCardView
            title="Maison Rose"
            href="/products/maison-rose"
            thumbnail="/favicon.ico"
            priceLabel="$120.00"
          />
          <ProductCardView
            title={longTitle}
            href="/products/long-title"
            thumbnail="/favicon.ico"
            priceLabel="$95.00"
          />
          <ProductCardView
            title="No thumbnail"
            href="/products/no-thumbnail"
            thumbnail={null}
            priceLabel="$80.00"
          />
          <ProductCardView
            title="On sale"
            href="/products/on-sale"
            thumbnail="/favicon.ico"
            priceLabel="$60.00"
            originalPriceLabel="$90.00"
          />
        </div>
      </section>

      <DesignSystemDemos />
    </main>
  )
}
