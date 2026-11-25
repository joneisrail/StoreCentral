"use client"

import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { clx } from "@modules/common/components/ui"

type DropdownMenuItem = {
  label: string
  onSelect?: () => void
  href?: string
  disabled?: boolean
}

type DropdownMenuProps = {
  label: string
  items: DropdownMenuItem[]
}

const ring =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-deep focus-visible:ring-offset-2"

const itemClass =
  "flex min-h-[44px] w-full items-center px-4 py-2 text-left text-sm text-charcoal data-[focus]:bg-ivory data-[disabled]:cursor-not-allowed data-[disabled]:text-warm-grey lg:min-h-0"

const DropdownMenu = ({ label, items }: DropdownMenuProps) => {
  return (
    <Menu as="div" className="relative inline-block text-left">
      <MenuButton
        className={clx(
          "inline-flex min-h-[44px] items-center rounded-soft border border-line bg-paper px-4 text-sm text-charcoal hover:bg-ivory lg:min-h-0 lg:py-2",
          ring
        )}
      >
        {label}
      </MenuButton>
      <MenuItems
        anchor="bottom start"
        transition
        className="z-50 mt-1 min-w-[12rem] rounded-soft border border-line bg-paper py-1 shadow-lg focus:outline-none motion-safe:transition motion-safe:duration-100 data-[closed]:opacity-0"
      >
        {items.map((item) => (
          <MenuItem key={item.label} disabled={item.disabled}>
            {item.href && !item.disabled ? (
              <LocalizedClientLink
                href={item.href}
                className={itemClass}
                onClick={item.onSelect}
              >
                {item.label}
              </LocalizedClientLink>
            ) : (
              <button type="button" className={itemClass} onClick={item.onSelect}>
                {item.label}
              </button>
            )}
          </MenuItem>
        ))}
      </MenuItems>
    </Menu>
  )
}

export default DropdownMenu
