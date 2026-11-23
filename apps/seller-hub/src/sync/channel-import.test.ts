import { describe, expect, it } from 'vitest'
import { planImport, type ChannelListing, type StoreVariant } from './channel-import.js'

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

  it('variable parent with one duplicate variation skips all siblings', () => {
    const s1 = listing('1', 'S1', 'P'), s2 = listing('2', 'S2', 'P'), s3 = listing('3', 'DUP', 'P')
    const dup = listing('4', 'DUP')
    const other = listing('5', 'O1', 'Q')
    const plan = planImport([s1, s2, s3, dup, other], [])
    expect(plan.unmatched).toEqual([other])
    expect(plan.matched).toEqual([])
    expect(plan.noSku).toEqual([])
    expect([...plan.duplicates].sort()).toEqual(['DUP', 'S1', 'S2'])
  })

  it('empty inputs', () => {
    expect(planImport([], [])).toEqual({ matched: [], unmatched: [], duplicates: [], noSku: [] })
  })
})
