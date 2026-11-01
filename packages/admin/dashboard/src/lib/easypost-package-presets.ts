export type EasyPostPackagePreset = {
  carrier: "USPS" | "FedEx"
  code: string
  label: string
}

/**
 * The USPS/FedEx `predefined_package` codes `PackagePopover` offers as presets,
 * each paired with a human-readable label (including the carrier's documented
 * dimensions, where it has them).
 *
 * Verified directly against EasyPost's live Carrier Metadata API
 * (`CarrierMetadata.retrieve(['USPS', 'FedEx'], ['predefined_packages'])`) rather
 * than static documentation, which defers this list to that same live endpoint.
 * Deliberately excludes USPS's bulk-mail-only equipment (presort/bulk mail trays
 * and sacks: FlatTubTrayBox, EMMTrayBox, FullTrayBox, HalfTrayBox, PMODSack), the
 * APO/FPO military-address variant (LargeFlatRateBoxAPOFPO), and the generic
 * no-dimension "FedExBox" entry - none of which apply to shipping an individual
 * customer order.
 */
export const EASYPOST_PACKAGE_PRESETS: EasyPostPackagePreset[] = [
  { carrier: "USPS", code: "Card", label: "USPS Card (6in x 4.5in x 0.016in)" },
  { carrier: "USPS", code: "Letter", label: "USPS Letter (11.5in x 6.125in x 0.25in)" },
  { carrier: "USPS", code: "Flat", label: "USPS Flat (11.5in x 6.125in x 0.75in)" },
  { carrier: "USPS", code: "FlatRateEnvelope", label: "USPS Flat Rate Envelope (12.5in x 9.5in)" },
  { carrier: "USPS", code: "FlatRateLegalEnvelope", label: "USPS Flat Rate Legal Envelope (15in x 9.5in)" },
  { carrier: "USPS", code: "FlatRatePaddedEnvelope", label: "USPS Flat Rate Padded Envelope (12.5in x 9.5in)" },
  { carrier: "USPS", code: "FlatRateWindowEnvelope", label: "USPS Flat Rate Window Envelope (10in x 5in)" },
  { carrier: "USPS", code: "FlatRateCardboardEnvelope", label: "USPS Flat Rate Cardboard Envelope (12.5in x 9.5in)" },
  { carrier: "USPS", code: "SmallFlatRateEnvelope", label: "USPS Small Flat Rate Envelope (10in x 6in)" },
  { carrier: "USPS", code: "SmallFlatRateBox", label: "USPS Small Flat Rate Box (8.6875in x 5.4375in x 1.75in)" },
  { carrier: "USPS", code: "MediumFlatRateBox", label: "USPS Medium Flat Rate Box (11.25in x 8.75in x 6in)" },
  { carrier: "USPS", code: "LargeFlatRateBox", label: "USPS Large Flat Rate Box (12.25in x 12in x 6in)" },
  { carrier: "USPS", code: "Parcel", label: "USPS Parcel (rate based on weight)" },
  { carrier: "USPS", code: "SoftPack", label: "USPS SoftPack (rate based on weight)" },
  { carrier: "FedEx", code: "FedExEnvelope", label: "FedEx Envelope (9.5in x 12.5in, up to ~60 pages)" },
  { carrier: "FedEx", code: "FedExPak", label: "FedEx Pak (12in x 15.5in)" },
  { carrier: "FedEx", code: "FedExTube", label: "FedEx Tube (38in x 6in x 6in x 6in)" },
  { carrier: "FedEx", code: "FedEx10kgBox", label: "FedEx 10kg Box (15.81in x 12.94in x 10.19in, max 10kg)" },
  { carrier: "FedEx", code: "FedEx25kgBox", label: "FedEx 25kg Box (21.56in x 16.56in x 13.19in, max 25kg)" },
  { carrier: "FedEx", code: "FedExExtraSmallBox", label: "FedEx Extra Small Box (7.25in x 2.5in x 4.7in)" },
  { carrier: "FedEx", code: "FedExSmallBox", label: "FedEx Small Box (12.25in x 10.9in x 1.5in)" },
  { carrier: "FedEx", code: "FedExMediumBox", label: "FedEx Medium Box (13.25in x 11.5in x 2.38in)" },
  { carrier: "FedEx", code: "FedExLargeBox", label: "FedEx Large Box (17.88in x 12.38in x 3in)" },
  { carrier: "FedEx", code: "FedExExtraLargeBox", label: "FedEx Extra Large Box (11.88in x 10.75in x 11in)" },
]
