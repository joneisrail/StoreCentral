import Stars from "./stars"

const ReviewSummary = ({
  average,
  count,
}: {
  average: number | null
  count: number
}) => {
  if (count <= 0 || average === null) {
    return null
  }
  const noun = count === 1 ? "review" : "reviews"
  return (
    <div className="flex items-center gap-2">
      <Stars value={average} />
      <span className="text-sm text-charcoal">
        <span className="sr-only">{`${average} out of 5, ${count} ${noun}`}</span>
        <span aria-hidden="true">{`${average} (${count})`}</span>
      </span>
    </div>
  )
}

export default ReviewSummary
