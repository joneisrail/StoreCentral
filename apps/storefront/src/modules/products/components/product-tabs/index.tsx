"use client"

import { HttpTypes } from "@medusajs/types"
import { ReactNode } from "react"

import Accordion from "./accordion"
import ProductSpecs, { getSpecRows } from "../product-specs"

type ProductTabsProps = {
  product: HttpTypes.StoreProduct
  shippingNote?: string
  returnsNote?: string
}

const ProductTabs = ({
  product,
  shippingNote,
  returnsNote,
}: ProductTabsProps) => {
  const shipping = shippingNote?.trim()
  const returns = returnsNote?.trim()

  const tabs: Array<{ label: string; component: ReactNode }> = []

  if (getSpecRows(product).length > 0) {
    tabs.push({
      label: "Specifications",
      component: <ProductSpecs product={product} />,
    })
  }

  if (shipping || returns) {
    tabs.push({
      label: "Shipping and returns",
      component: (
        <div className="grid gap-y-4 py-4 text-sm text-charcoal">
          {shipping && <p className="whitespace-pre-line">{shipping}</p>}
          {returns && <p className="whitespace-pre-line">{returns}</p>}
        </div>
      ),
    })
  }

  if (tabs.length === 0) {
    return null
  }

  return (
    <div className="w-full">
      <Accordion type="multiple">
        {tabs.map((tab) => (
          <Accordion.Item
            key={tab.label}
            title={tab.label}
            headingSize="medium"
            value={tab.label}
          >
            {tab.component}
          </Accordion.Item>
        ))}
      </Accordion>
    </div>
  )
}

export default ProductTabs
