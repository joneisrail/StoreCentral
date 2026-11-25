export type Img = { src: string; alt: string }

export type HeroContent = {
  eyebrow?: string
  headline: string
  subheadline?: string
  cta?: { label: string; href: string }
  image?: Img
}

export type Promo = {
  id: string
  title: string
  text?: string
  href: string
  ctaLabel: string
  image?: Img
}

export type EditorialBlock = {
  id: string
  title: string
  text: string
  href?: string
  linkLabel?: string
  image?: Img
}

export type HomepageContent = {
  description: string
  announcement: { text: string; href?: string } | null
  hero: HeroContent
  promos: Promo[]
  editorial: EditorialBlock[]
}

export const homepageContent: HomepageContent = {
  description: "Fine fragrance, delivered.",
  announcement: null,
  hero: {
    headline: "Discover your signature scent",
    cta: { label: "Shop all", href: "/store" },
  },
  promos: [],
  editorial: [],
}

export const getNewsletterAction = (
  env: Record<string, string | undefined> = process.env
): string | null => {
  const value = env.NEXT_PUBLIC_NEWSLETTER_ACTION_URL?.trim()
  if (!value) {
    return null
  }
  try {
    return new URL(value).protocol === "https:" ? value : null
  } catch {
    return null
  }
}
