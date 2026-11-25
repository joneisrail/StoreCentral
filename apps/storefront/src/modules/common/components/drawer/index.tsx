"use client"

import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from "@headlessui/react"
import { clx } from "@modules/common/components/ui"
import type { ReactNode } from "react"

type DrawerProps = {
  open: boolean
  onClose: () => void
  title: string
  side?: "left" | "right"
  children?: ReactNode
  className?: string
  backdropTestId?: string
  panelTestId?: string
  closeTestId?: string
}

const Drawer = ({
  open,
  onClose,
  title,
  side = "right",
  children,
  className,
  backdropTestId,
  panelTestId,
  closeTestId,
}: DrawerProps) => {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-[60]">
      <DialogBackdrop
        data-drawer-overlay
        data-testid={backdropTestId}
        transition
        className="fixed inset-0 bg-[rgb(30_29_27/0.4)] motion-safe:transition-opacity motion-safe:duration-200 data-[closed]:opacity-0"
      />
      <div
        className={clx(
          "fixed inset-y-0 flex max-w-full",
          side === "left" ? "left-0" : "right-0"
        )}
      >
        <DialogPanel
          transition
          data-testid={panelTestId}
          className={clx(
            "flex h-full w-screen max-w-sm flex-col border-line bg-paper p-6 text-charcoal shadow-xl motion-safe:transition-transform motion-safe:duration-200",
            side === "left"
              ? "border-r data-[closed]:-translate-x-full"
              : "border-l data-[closed]:translate-x-full",
            className
          )}
        >
          <div className="flex items-center justify-between gap-4">
            <DialogTitle className="text-lg font-medium">{title}</DialogTitle>
            <button
              type="button"
              aria-label="Close"
              autoFocus
              data-testid={closeTestId}
              onClick={onClose}
              className="flex h-11 w-11 items-center justify-center rounded-soft text-charcoal hover:bg-ivory focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-deep focus-visible:ring-offset-2 lg:h-9 lg:w-9"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <path d="M5 5l10 10M15 5L5 15" />
              </svg>
            </button>
          </div>
          <div className="mt-4 min-h-0 flex-1 overflow-y-auto">{children}</div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}

export default Drawer
