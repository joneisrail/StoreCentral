export const CARRIER_SUGGESTIONS = ["UPS", "FedEx", "USPS", "DHL", "Other"]

const TRACKING_URL_TEMPLATES: Record<string, string> = {
  ups: "https://www.ups.com/track?tracknum={n}",
  fedex: "https://www.fedex.com/fedextrack/?trknbr={n}",
  usps: "https://tools.usps.com/go/TrackConfirmAction?tLabels={n}",
  dhl: "https://www.dhl.com/en/express/tracking.html?AWB={n}",
}

/** A tracking link for a known carrier, or undefined for any other carrier. */
export const buildTrackingUrl = (
  carrier: string,
  trackingNumber: string
): string | undefined => {
  const template = TRACKING_URL_TEMPLATES[carrier.trim().toLowerCase()]

  if (!template || !trackingNumber.trim()) {
    return undefined
  }

  return template.replace("{n}", encodeURIComponent(trackingNumber.trim()))
}
