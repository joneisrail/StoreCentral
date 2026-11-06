type Rankable = { unit_cost: number | null; is_active: boolean }

// Cheapest first (null prices last, ties keep input order). Every active offer
// at the lowest active price is marked; inactive suppliers never are.
export const rankOffers = <T extends Rankable>(
  offers: T[]
): (T & { is_lowest: boolean })[] => {
  const sorted = offers
    .map((offer, index) => ({ offer, index }))
    .sort((a, b) => {
      const x = a.offer.unit_cost
      const y = b.offer.unit_cost
      if (x === y) return a.index - b.index
      if (x === null) return 1
      if (y === null) return -1
      return x - y || a.index - b.index
    })
    .map(({ offer }) => offer)

  const activePrices = sorted
    .filter((o) => o.is_active && o.unit_cost !== null)
    .map((o) => o.unit_cost as number)
  const lowest = activePrices.length ? Math.min(...activePrices) : null

  return sorted.map((o) => ({
    ...o,
    is_lowest: lowest !== null && o.is_active && o.unit_cost === lowest,
  }))
}
