"use client"

import {
  BRAND_ATTRIBUTE,
  CATEGORY_ATTRIBUTE,
  FAMILY_ATTRIBUTE,
  GENDER_ATTRIBUTE,
  LABELS_ATTRIBUTE,
  NOTES_ATTRIBUTE,
} from "./attributes"
import AvailabilityToggle from "./availability-toggle"
import OnSaleToggle from "./on-sale-toggle"
import OptionRefinements from "./option-refinements"
import PriceRange from "./price-range"
import RefinementGroup from "./refinement-group"

const StoreRefinements = ({ currencyCode }: { currencyCode: string }) => {
  return (
    <div className="flex flex-col gap-12">
      <RefinementGroup attribute={BRAND_ATTRIBUTE} title="Brand" />
      <RefinementGroup attribute={CATEGORY_ATTRIBUTE} title="Category" />
      <RefinementGroup attribute={GENDER_ATTRIBUTE} title="Gender" />
      <RefinementGroup attribute={FAMILY_ATTRIBUTE} title="Fragrance family" />
      <RefinementGroup attribute={NOTES_ATTRIBUTE} title="Notes" />
      <PriceRange currencyCode={currencyCode} />
      <AvailabilityToggle />
      <OnSaleToggle currencyCode={currencyCode} />
      <OptionRefinements />
      <RefinementGroup attribute={LABELS_ATTRIBUTE} title="Labels" />
    </div>
  )
}

export default StoreRefinements
