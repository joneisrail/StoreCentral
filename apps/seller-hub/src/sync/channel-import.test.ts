import { describe, expect, it } from 'vitest'
import { planImport, titleOf, type ChannelListing, type StoreVariant } from './channel-import.js'

const listing = (externalId: string, sku: string | null, parentExternalId: string | null = null): ChannelListing => ({
  externalId, parentExternalId, sku, title: `T${externalId}`, parentTitle: null,
  price: '10.00', stock: 1, imageUrl: null, currency: 'USD',
})
const variant = (sku: string, n = sku): StoreVariant => ({ variantId: `v_${n}`, productId: `p_${n}`, sku })

describe('planImport', () => {
  it('matches by exact trimmed sku', () => {
    const a = listing('1', 'A'), b = listing('2', 'B')
    const plan = planImport([a, b], [variant('A')])
    expect(plan).toEqual({ matched: [a], unmatched: [b], duplicates: [], noSku: [] })
  })

  it('case differs so unmatched', () => {
    const a = listing('1', 'abc')
    expect(planImport([a], [variant('ABC')])).toEqual({ matched: [], unmatched: [a], duplicates: [], noSku: [] })
  })

  it('padded sku trimmed on channel side matches', () => {
    const a = listing('1', '  A1 ')
    expect(planImport([a], [variant('A1')])).toEqual({ matched: [a], unmatched: [], duplicates: [], noSku: [] })
  })

  it('duplicate on channel side', () => {
    const a = listing('1', 'D'), b = listing('2', 'D'), c = listing('3', 'C')
    expect(planImport([a, b, c], [variant('D'), variant('C')])).toEqual({
      matched: [c], unmatched: [], duplicates: ['D'], noSku: [],
    })
  })

  it('duplicate on store side', () => {
    const a = listing('1', 'D')
    expect(planImport([a], [variant('D', '1'), variant('D', '2')])).toEqual({
      matched: [], unmatched: [], duplicates: ['D'], noSku: [],
    })
  })

  it('no sku listed separately', () => {
    const a = listing('1', null), b = listing('2', '   ')
    expect(planImport([a, b], [])).toEqual({ matched: [], unmatched: [], duplicates: [], noSku: [a, b] })
  })

  it('variable parent with a duplicate variation drops its unmatched siblings and reports their skus', () => {
    const s1 = listing('1', 'S1', 'P'), s2 = listing('2', 'S2', 'P'), s3 = listing('3', 'DUP', 'P')
    const dup = listing('4', 'DUP')
    const other = listing('5', 'O1', 'Q')
    const plan = planImport([s1, s2, s3, dup, other], [])
    expect(plan.unmatched).toEqual([other])
    expect(plan.matched).toEqual([])
    expect(plan.noSku).toEqual([])
    expect([...plan.duplicates].sort()).toEqual(['DUP', 'S1', 'S2'])
  })

  it('poisoned parent keeps its matched sibling and drops the unmatched one', () => {
    const m = listing('1', 'M', 'P'), d = listing('2', 'DUP', 'P'), u = listing('3', 'U', 'P')
    const dup2 = listing('4', 'DUP')
    const plan = planImport([m, d, u, dup2], [variant('M')])
    expect(plan.matched).toEqual([m])
    expect(plan.unmatched).toEqual([])
    expect(plan.noSku).toEqual([])
    expect([...plan.duplicates].sort()).toEqual(['DUP', 'U'])
  })

  it('no-sku sibling poisons the parent and stays in noSku', () => {
    const n = listing('1', null, 'P'), u = listing('2', 'U', 'P'), m = listing('3', 'M', 'P')
    const plan = planImport([n, u, m], [variant('M')])
    expect(plan.noSku).toEqual([n])
    expect(plan.matched).toEqual([m])
    expect(plan.unmatched).toEqual([])
    expect(plan.duplicates).toEqual(['U'])
  })

  it('store duplicates unrelated to the channel are not reported', () => {
    expect(planImport([], [variant('X', '1'), variant('X', '2')]).duplicates).toEqual([])
    expect(planImport([listing('1', 'X')], [variant('X', '1'), variant('X', '2')]).duplicates).toEqual(['X'])
  })

  it('channel D and padded D count as duplicates', () => {
    const plan = planImport([listing('1', 'D'), listing('2', ' D ')], [variant('D')])
    expect(plan).toEqual({ matched: [], unmatched: [], duplicates: ['D'], noSku: [] })
  })

  it('null store sku is treated as absent', () => {
    const bad = { variantId: 'v', productId: 'p', sku: null } as unknown as StoreVariant
    const a = listing('1', 'A')
    expect(planImport([a], [bad])).toEqual({ matched: [], unmatched: [a], duplicates: [], noSku: [] })
  })

  it('empty inputs', () => {
    expect(planImport([], [])).toEqual({ matched: [], unmatched: [], duplicates: [], noSku: [] })
  })
})

describe('titleOf', () => {
  const t = (title: string, parentTitle: string | null, sku: string | null = 'S') =>
    titleOf({ ...listing('1', sku), title, parentTitle })

  it('joins parent and variant titles when both exist and differ', () => {
    expect(t('Red', 'Shirt')).toBe('Shirt - Red')
  })

  it('uses the variant title when the parent matches or is missing', () => {
    expect(t('Mug', 'Mug')).toBe('Mug')
    expect(t('Mug', null)).toBe('Mug')
  })

  it("drops Shopify's Default Title variant name", () => {
    expect(t('Default Title', 'Poster')).toBe('Poster')
  })

  it('falls back to the parent title, then the sku', () => {
    expect(t('', 'Poster')).toBe('Poster')
    expect(t('', null, ' SKU-1 ')).toBe('SKU-1')
  })
})
