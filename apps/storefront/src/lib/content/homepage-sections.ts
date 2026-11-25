export type SectionDef =
  | { id: string; title: string; kind: "collection"; collectionHandle: string }
  | { id: "new-arrivals"; title: string; kind: "latest" }

export const PRODUCT_SECTIONS: SectionDef[] = [
  {
    id: "best-sellers",
    title: "Best sellers",
    kind: "collection",
    collectionHandle: "best-sellers",
  },
  { id: "new-arrivals", title: "New arrivals", kind: "latest" },
  {
    id: "trending",
    title: "Trending fragrances",
    kind: "collection",
    collectionHandle: "trending",
  },
  {
    id: "mens",
    title: "Men's collection",
    kind: "collection",
    collectionHandle: "mens",
  },
  {
    id: "womens",
    title: "Women's collection",
    kind: "collection",
    collectionHandle: "womens",
  },
  {
    id: "unisex",
    title: "Unisex collection",
    kind: "collection",
    collectionHandle: "unisex",
  },
  {
    id: "arabic",
    title: "Arabic fragrances",
    kind: "collection",
    collectionHandle: "arabic",
  },
  {
    id: "niche",
    title: "Niche fragrances",
    kind: "collection",
    collectionHandle: "niche",
  },
]

export type ResolvedSection =
  | {
      id: string
      title: string
      kind: "collection"
      collection: { id: string; handle: string }
    }
  | { id: "new-arrivals"; title: string; kind: "latest" }

export const resolveProductSections = (
  defs: SectionDef[],
  collections: { id: string; handle: string }[]
): ResolvedSection[] => {
  const resolved: ResolvedSection[] = []
  for (const def of defs) {
    if (def.kind === "latest") {
      resolved.push(def)
      continue
    }
    const match = collections.find((c) => c.handle === def.collectionHandle)
    if (match) {
      resolved.push({
        id: def.id,
        title: def.title,
        kind: "collection",
        collection: { id: match.id, handle: match.handle },
      })
    }
  }
  return resolved
}
