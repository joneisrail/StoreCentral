"use client"

import SearchHit from "./hit"
import { Group, Option, type RowHandlers } from "./option"
import type { Section } from "./rows"

type ResultsListProps = RowHandlers & {
  sections: Section[]
  currencyCode: string
}

/** Product, brand and category rows for a query, then "See all results". */
const ResultsList = ({ sections, currencyCode, ...handlers }: ResultsListProps) => (
  <>
    {sections.map((section) => (
      <Group
        key={section.key}
        section={section}
        testId={`search-results-${section.key}`}
      >
        {section.rows.map((row) => {
          switch (row.kind) {
            case "product":
              return (
                <Option key={row.id} row={row} {...handlers}>
                  <SearchHit hit={row.hit} currencyCode={currencyCode} />
                </Option>
              )
            case "brand":
            case "category":
              return (
                <Option key={row.id} row={row} {...handlers}>
                  {row.value}
                </Option>
              )
            case "all":
              return (
                <Option
                  key={row.id}
                  row={row}
                  {...handlers}
                  className="font-medium text-gold-deep"
                >
                  See all results for “{row.query}”
                </Option>
              )
            default:
              return null
          }
        })}
      </Group>
    ))}
  </>
)

export default ResultsList
