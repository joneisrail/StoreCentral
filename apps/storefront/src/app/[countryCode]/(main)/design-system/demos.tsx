"use client"

import { useState, type ReactNode } from "react"
import Drawer from "@modules/common/components/drawer"
import DropdownMenu from "@modules/common/components/dropdown-menu"
import {
  Skeleton,
  SkeletonImage,
  SkeletonText,
} from "@modules/common/components/skeleton"
import { useToast } from "@modules/common/components/toast"
import {
  Badge,
  Button,
  Checkbox,
  Input,
} from "@modules/common/components/ui"

const Section = ({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) => (
  <section className="flex flex-col gap-4">
    <h2 className="font-serif text-2xl text-charcoal">{title}</h2>
    {children}
  </section>
)

export default function DesignSystemDemos() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { toast } = useToast()

  return (
    <div className="flex flex-col gap-12">
      <Section title="Buttons">
        <div className="flex flex-wrap gap-3">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="transparent">Transparent</Button>
          <Button variant="gold">Gold</Button>
        </div>
      </Section>

      <Section title="Form controls">
        <div className="flex max-w-sm flex-col gap-4">
          <Input label="Email" placeholder="you@example.com" />
          <Checkbox label="Subscribe to the newsletter" id="ds-checkbox" />
        </div>
      </Section>

      <Section title="Badges">
        <div className="flex flex-wrap gap-3">
          <Badge color="grey">Grey</Badge>
          <Badge color="green">Green</Badge>
          <Badge color="red">Red</Badge>
          <Badge color="orange">Orange</Badge>
          <Badge color="purple">Purple</Badge>
        </div>
      </Section>

      <Section title="Drawer and dropdown menu">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => setDrawerOpen(true)}>
            Open drawer
          </Button>
          <DropdownMenu
            label="Open menu"
            items={[
              { label: "First action" },
              { label: "Second action" },
              { label: "Disabled action", disabled: true },
            ]}
          />
        </div>
        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          title="Example drawer"
        >
          <p className="text-sm text-warm-grey">
            Drawer content goes here. Press Escape or the close button to
            dismiss.
          </p>
        </Drawer>
      </Section>

      <Section title="Toasts">
        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            onClick={() =>
              toast({
                title: "Heads up",
                description: "An info toast",
                tone: "info",
              })
            }
          >
            Info toast
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              toast({
                title: "Saved",
                description: "A success toast",
                tone: "success",
              })
            }
          >
            Success toast
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              toast({
                title: "Failed",
                description: "An error toast",
                tone: "error",
              })
            }
          >
            Error toast
          </Button>
        </div>
      </Section>

      <Section title="Skeletons">
        <div className="grid max-w-md gap-4">
          <Skeleton className="h-6 w-40" />
          <SkeletonText lines={3} />
          <SkeletonImage />
        </div>
      </Section>
    </div>
  )
}
