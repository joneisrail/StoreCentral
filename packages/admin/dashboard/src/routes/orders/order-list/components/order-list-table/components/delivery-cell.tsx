/**
 * Read-only delivery method: the order's first shipping method name.
 */
export const DeliveryCell = ({ name }: { name?: string | null }) => (
  <div className="flex h-full w-full items-center overflow-hidden">
    {name ? (
      <span className="truncate">{name}</span>
    ) : (
      <span className="text-ui-fg-muted">-</span>
    )}
  </div>
)
