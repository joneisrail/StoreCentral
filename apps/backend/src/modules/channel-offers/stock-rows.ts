// Bulk stock read shared by the grid route and the one-time split script. Raw
// read-only SQL on purpose: the graph/module readers cost ~0.25ms per row here
// (about 2s for 5,000 variants) while this aggregate takes ~0.1s. It touches the
// inventory module's `inventory_level` and the product<->inventory link table,
// soft deletes respected; the net-stock math itself stays in availableFromItems.
export const STOCK_ROWS_SQL = `
  select l.variant_id, l.required_quantity,
         coalesce(sum(il.stocked_quantity - il.reserved_quantity), 0) as net
  from product_variant_inventory_item l
  left join inventory_level il
    on il.inventory_item_id = l.inventory_item_id and il.deleted_at is null
  where l.deleted_at is null
  group by l.variant_id, l.inventory_item_id, l.required_quantity`

export type StockRow = {
  variant_id: string
  required_quantity: number | null
  net: number | string
}
