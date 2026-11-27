import type { SearchTypes } from "@medusajs/framework/types";
import { MedusaError } from "@medusajs/framework/utils";

type SearchFilterValue = SearchTypes.SearchFilterValue;
type SearchFilters = SearchTypes.SearchFilters;

const FIELD_NAME = /^[A-Za-z0-9_.]+$/;

const COMPARISON_OPERATORS: Record<string, string> = {
  $eq: "=",
  $ne: "!=",
  $lt: "<",
  $lte: "<=",
  $gt: ">",
  $gte: ">=",
};

function invalid(message: string): never {
  throw new MedusaError(MedusaError.Types.INVALID_DATA, message);
}

/**
 * Renders a value as a Meilisearch filter literal. Strings are double-quoted
 * with `\` and `"` escaped, so a value can never leave its literal; numbers and
 * booleans are bare.
 */
export function escapeValue(value: SearchFilterValue): string {
  if (typeof value === "string") {
    return `"${value.replace(/[\\"]/g, "\\$&")}"`;
  }

  if (typeof value === "boolean") {
    return String(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      invalid(`Meilisearch filters cannot compare against ${value}.`);
    }

    return String(value);
  }

  if (value instanceof Date) {
    invalid(
      "Meilisearch filters do not support Date values; pass a number or string.",
    );
  }

  return invalid(`Unsupported Meilisearch filter value: ${String(value)}.`);
}

function fieldName(field: string): string {
  if (!FIELD_NAME.test(field)) {
    invalid(`Invalid filter field name "${field}".`);
  }

  return field;
}

function list(values: SearchFilterValue[]): string {
  return `[${values.map(escapeValue).join(",")}]`;
}

function operatorClauses(
  field: string,
  operators: Record<string, unknown>,
): string[] {
  const clauses: string[] = [];

  for (const [operator, operand] of Object.entries(operators)) {
    if (operand === undefined) {
      continue;
    }

    if (operator in COMPARISON_OPERATORS) {
      clauses.push(
        `${field} ${COMPARISON_OPERATORS[operator]} ${escapeValue(operand as SearchFilterValue)}`,
      );
      continue;
    }

    switch (operator) {
      case "$in":
      case "$overlaps":
        clauses.push(`${field} IN ${list(requireArray(operator, operand))}`);
        break;
      case "$nin":
        clauses.push(`${field} NOT IN ${list(requireArray(operator, operand))}`);
        break;
      case "$exists":
        clauses.push(`${field} ${operand ? "EXISTS" : "NOT EXISTS"}`);
        break;
      case "$contains": {
        const values = Array.isArray(operand) ? operand : [operand];

        for (const value of values as SearchFilterValue[]) {
          clauses.push(`${field} = ${escapeValue(value)}`);
        }
        break;
      }
      default:
        invalid(
          `The ${operator} operator is not supported by the Meilisearch search provider.`,
        );
    }
  }

  return clauses;
}

function requireArray(operator: string, operand: unknown): SearchFilterValue[] {
  if (!Array.isArray(operand)) {
    invalid(`The ${operator} operator takes an array.`);
  }

  return operand as SearchFilterValue[];
}

function fieldClauses(field: string, value: unknown): string[] {
  const name = fieldName(field);

  if (value === undefined) {
    return [];
  }

  if (value === null) {
    return [`${name} IS NULL`];
  }

  if (Array.isArray(value)) {
    return [`${name} IN ${list(value as SearchFilterValue[])}`];
  }

  if (typeof value === "object" && !(value instanceof Date)) {
    return operatorClauses(name, value as Record<string, unknown>);
  }

  return [`${name} = ${escapeValue(value as SearchFilterValue)}`];
}

/**
 * Parenthesises a list of AND-ed clauses when there is more than one.
 */
function group(clauses: string[]): string | undefined {
  if (!clauses.length) {
    return undefined;
  }

  return clauses.length > 1 ? `(${clauses.join(" AND ")})` : clauses[0];
}

function compile(filters: SearchFilters): string[] {
  const clauses: string[] = [];

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || key === "q") {
      continue;
    }

    if (key === "$or") {
      const branches = value as SearchFilters[];

      if (!branches.length) {
        invalid("The $or operator needs at least one filter.");
      }

      const children = branches.map((child) => group(compile(child)));

      // A branch with no constraint matches everything, so the whole $or does.
      if (children.some((child) => !child)) {
        continue;
      }

      const joined = children.join(" OR ");
      clauses.push(children.length > 1 ? `(${joined})` : joined);
    } else if (key === "$and") {
      const children = (value as SearchFilters[])
        .map((child) => group(compile(child)))
        .filter((child): child is string => !!child);

      if (!children.length) {
        continue;
      }

      const joined = children.join(" AND ");
      clauses.push(children.length > 1 ? `(${joined})` : joined);
    } else if (key === "$not") {
      const inner = compile(value as SearchFilters);

      if (!inner.length) {
        invalid("The $not operator needs a filter that constrains something.");
      }

      // A lone group is already parenthesised; a group's text starts with `(`
      // and a field clause never does.
      clauses.push(
        inner.length === 1 && inner[0].startsWith("(")
          ? `NOT ${inner[0]}`
          : `NOT (${inner.join(" AND ")})`,
      );
    } else {
      clauses.push(...fieldClauses(key, value));
    }
  }

  return clauses;
}

/**
 * Translates the search filter tree into a Meilisearch filter expression. The
 * free-text `q` is lifted out by the module and ignored here. Returns
 * `undefined` when there is nothing to filter on.
 */
export function toMeiliFilter(
  filters: SearchFilters | undefined,
): string | undefined {
  if (!filters) {
    return undefined;
  }

  const clauses = compile(filters);

  return clauses.length ? clauses.join(" AND ") : undefined;
}
