import type { FragranceProfile } from "@lib/util/fragrance-profile"

const NOTE_GROUPS: Array<{ label: string; key: "top" | "middle" | "base" }> = [
  { label: "Top notes", key: "top" },
  { label: "Middle notes", key: "middle" },
  { label: "Base notes", key: "base" },
]

const FragranceProfileSection = ({ profile }: { profile: FragranceProfile }) => {
  if (profile.isEmpty) {
    return null
  }

  const rows = [
    { label: "Family", value: profile.family },
    { label: "Gender", value: profile.gender },
    { label: "Concentration", value: profile.concentration },
  ].filter((row) => row.value)

  const groups = NOTE_GROUPS.filter((group) => profile[group.key].length > 0)

  return (
    <section aria-labelledby="fragrance-profile-heading">
      <h2
        id="fragrance-profile-heading"
        className="font-serif text-xl text-charcoal"
      >
        Fragrance profile
      </h2>
      <dl className="mt-4 grid gap-y-3">
        {rows.map((row) => (
          <div key={row.label} className="flex gap-x-4 text-sm">
            <dt className="w-32 shrink-0 text-warm-grey">{row.label}</dt>
            <dd className="text-charcoal">{row.value}</dd>
          </div>
        ))}
        {groups.map((group) => (
          <div key={group.key} className="flex gap-x-4 text-sm">
            <dt className="w-32 shrink-0 pt-1 text-warm-grey">{group.label}</dt>
            <dd>
              <ul className="flex flex-wrap gap-2">
                {profile[group.key].map((note) => (
                  <li
                    key={note}
                    className="rounded-full border border-line px-3 py-1 text-charcoal"
                  >
                    {note}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export default FragranceProfileSection
