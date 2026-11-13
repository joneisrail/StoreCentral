// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import {
  MARKETPLACES,
  MarketplacePicker,
  MarketplaceType,
  defaultCredentials,
} from ".."

const Harness = () => {
  const [value, setValue] = useState<MarketplaceType>("none")
  const [values, setValues] = useState<Record<string, string>>({})
  return (
    <MarketplacePicker
      value={value}
      onChange={(next) => {
        setValue(next)
        setValues(defaultCredentials(next))
      }}
      values={values}
      onValueChange={(name, v) => setValues((prev) => ({ ...prev, [name]: v }))}
    />
  )
}

const choose = (label: string) =>
  fireEvent.click(screen.getByRole("radio", { name: label }))

afterEach(cleanup)

describe("MarketplacePicker", () => {
  it("shows no marketplace fields by default", () => {
    render(<Harness />)
    expect(screen.queryByLabelText("Shop domain")).toBeNull()
    expect(screen.queryByLabelText("Site URL")).toBeNull()
    expect(screen.queryByLabelText("Seller ID")).toBeNull()
    expect(
      screen
        .getByRole("radio", { name: "salesChannels.marketplace.none" })
        .getAttribute("aria-checked")
    ).toBe("true")
  })

  it("choosing Shopify shows its four fields and hides others", () => {
    render(<Harness />)
    choose("Shopify")
    for (const label of [
      "Shop domain",
      "Access token",
      "Webhook secret",
      "Location ID",
    ]) {
      expect(screen.getByLabelText(label)).toBeTruthy()
    }
    expect(screen.queryByLabelText("Site URL")).toBeNull()
    expect(screen.queryByLabelText("Seller ID")).toBeNull()
  })

  it("lists WordPress for the woocommerce key", () => {
    expect(MARKETPLACES.woocommerce.label).toBe("WordPress")
  })

  it("secret fields render as password inputs and are never prefilled", () => {
    render(<Harness />)
    choose("Shopify")
    const token = screen.getByLabelText("Access token") as HTMLInputElement
    expect(token.type).toBe("password")
    expect(token.value).toBe("")
    expect(token.autocomplete).toBe("off")
    expect(
      (screen.getByLabelText("Shop domain") as HTMLInputElement).type
    ).toBe("text")
  })

  it("switching marketplace clears the previous fields", () => {
    render(<Harness />)
    choose("Shopify")
    fireEvent.change(screen.getByLabelText("Shop domain"), {
      target: { value: "x.myshopify.com" },
    })
    choose("Amazon")
    choose("Shopify")
    expect(
      (screen.getByLabelText("Shop domain") as HTMLInputElement).value
    ).toBe("")
  })

  it("Amazon shows the sync-not-live note and its default marketplace id", () => {
    render(<Harness />)
    expect(
      screen.queryByText("salesChannels.marketplace.syncNotLive")
    ).toBeNull()
    choose("Amazon")
    expect(
      screen.getByText("salesChannels.marketplace.syncNotLive")
    ).toBeTruthy()
    expect(
      (screen.getByLabelText("Marketplace ID") as HTMLInputElement).value
    ).toBe("ATVPDKIKX0DER")
  })
})
