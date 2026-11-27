const Stars = ({ value }: { value: number }) => (
  <span aria-hidden="true" className="inline-flex text-gold-deep">
    {[1, 2, 3, 4, 5].map((n) => (
      <svg
        key={n}
        viewBox="0 0 20 20"
        width="16"
        height="16"
        fill={n <= Math.round(value) ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M10 1.8l2.6 5.4 5.9.8-4.3 4.1 1 5.9L10 15.2 4.8 18l1-5.9L1.5 8l5.9-.8z" />
      </svg>
    ))}
  </span>
)

export default Stars
