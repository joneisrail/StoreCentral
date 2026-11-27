"use client"

import type { CatalogView } from "../store-hits/view-state"
import ViewToggle from "./index"

/** Link-mode toggle for server rendered listings: hrefs are plain data. */
const ViewToggleLinks = ({
  view,
  hrefs,
}: {
  view: CatalogView
  hrefs: Record<CatalogView, string>
}) => <ViewToggle view={view} hrefFor={(option) => hrefs[option]} />

export default ViewToggleLinks
