"use client"

import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from "@headlessui/react"
import React, { Fragment, type RefObject } from "react"

type SearchDrawerProps = {
  isOpen: boolean
  close: () => void
  /** Runs once the leave transition ends, to hand focus back to the opener. */
  afterLeave?: () => void
  initialFocus?: RefObject<HTMLElement | null>
  children: React.ReactNode
}

/**
 * The overlay's modal shell. Below 768px it fills the screen; from 768px up it
 * is a panel anchored under the navbar. Being a modal dialog, it traps focus
 * and locks body scroll at every size.
 */
const SearchDrawer = ({
  isOpen,
  close,
  afterLeave,
  initialFocus,
  children,
}: SearchDrawerProps) => (
  <Transition appear show={isOpen} as={Fragment} afterLeave={afterLeave}>
    <Dialog
      as="div"
      className="relative z-[75]"
      onClose={close}
      initialFocus={initialFocus}
    >
      <TransitionChild
        as={Fragment}
        enter="ease-out duration-200"
        enterFrom="opacity-0"
        enterTo="opacity-100"
        leave="ease-in duration-150"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
      >
        <div className="fixed inset-0" aria-hidden="true">
          <div className="h-full w-full bg-charcoal opacity-40" />
        </div>
      </TransitionChild>

      <TransitionChild
        as={Fragment}
        enter="ease-out duration-200"
        enterFrom="opacity-0"
        enterTo="opacity-100"
        leave="ease-in duration-150"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
      >
        <DialogPanel
          className="fixed inset-0 flex flex-col bg-ivory min-[768px]:inset-x-0 min-[768px]:bottom-auto min-[768px]:top-20 min-[768px]:mx-auto min-[768px]:max-h-[min(40rem,calc(100vh-7rem))] min-[768px]:w-[42rem] min-[768px]:max-w-[calc(100vw-2rem)] min-[768px]:rounded-soft min-[768px]:border min-[768px]:border-line-strong min-[768px]:shadow-elevation-modal"
          data-testid="search-drawer"
        >
          <DialogTitle className="sr-only">Search</DialogTitle>
          {children}
        </DialogPanel>
      </TransitionChild>
    </Dialog>
  </Transition>
)

export default SearchDrawer
