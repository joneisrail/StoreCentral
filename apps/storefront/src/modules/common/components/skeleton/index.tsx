import clsx from "clsx"

const bar = "rounded-soft bg-line motion-safe:animate-pulse"

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={clsx(bar, className)} />
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2">
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          data-skeleton-bar=""
          className={clsx(
            bar,
            "h-3",
            i === lines - 1 && lines > 1 ? "w-2/3" : "w-full"
          )}
        />
      ))}
    </div>
  )
}

type Ratio = "1/1" | "4/5" | "16/9"

export function SkeletonImage({ ratio = "4/5" }: { ratio?: Ratio }) {
  return (
    <div
      aria-hidden="true"
      className={clsx(bar, "w-full")}
      style={{ aspectRatio: ratio.replace("/", " / ") }}
    />
  )
}
