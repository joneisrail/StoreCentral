"use client"

import useToggleState from "@lib/hooks/use-toggle-state"
import { ArrowRightMini } from "@medusajs/icons"
import Drawer from "@modules/common/components/drawer"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { getStoreName } from "@lib/util/store-name"
import { Text, clx } from "@modules/common/components/ui"
import { useState } from "react"
import LanguageSelect from "../language-select"
import { Locale } from "@lib/data/locales"


const SideMenuItems = {
  Home: "/",
  Store: "/store",
  Account: "/account",
  Cart: "/cart",
}

type SideMenuProps = {
  locales: Locale[] | null
  currentLocale: string | null
}

const SideMenu = ({ locales, currentLocale }: SideMenuProps) => {
  const languageToggleState = useToggleState()
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)

  return (
    <div className="h-full">
      <div className="flex items-center h-full">
        <button
          type="button"
          data-testid="nav-menu-button"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          className="relative h-full min-h-[44px] flex items-center px-2 motion-safe:transition-colors hover:text-gold-deep focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-deep focus-visible:ring-offset-2 lg:min-h-0"
        >
          Menu
        </button>

        <Drawer
          open={open}
          onClose={close}
          title="Menu"
          side="left"
          backdropTestId="side-menu-backdrop"
          panelTestId="nav-menu-popup"
          closeTestId="close-menu-button"
        >
          <div className="flex h-full flex-col justify-between text-sm">
            <ul className="flex flex-col gap-6 items-start justify-start">
              {Object.entries(SideMenuItems).map(([name, href]) => {
                return (
                  <li key={name}>
                    <LocalizedClientLink
                      href={href}
                      className="inline-flex min-h-[44px] items-center text-3xl leading-10 hover:text-gold-deep focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-deep focus-visible:ring-offset-2"
                      onClick={close}
                      data-testid={`${name.toLowerCase()}-link`}
                    >
                      {name}
                    </LocalizedClientLink>
                  </li>
                )
              })}
            </ul>
            <div className="flex flex-col gap-y-6">
              {!!locales?.length && (
                <div
                  className="flex justify-between"
                  onMouseEnter={languageToggleState.open}
                  onMouseLeave={languageToggleState.close}
                >
                  <LanguageSelect
                    toggleState={languageToggleState}
                    locales={locales}
                    currentLocale={currentLocale}
                  />
                  <ArrowRightMini
                    className={clx(
                      "motion-safe:transition-transform motion-safe:duration-150",
                      languageToggleState.state ? "-rotate-90" : ""
                    )}
                  />
                </div>
              )}
              <Text className="flex justify-between txt-compact-small text-warm-grey">
                &copy; {new Date().getFullYear()} {getStoreName()}. All rights
                reserved.
              </Text>
            </div>
          </div>
        </Drawer>
      </div>
    </div>
  )
}

export default SideMenu
