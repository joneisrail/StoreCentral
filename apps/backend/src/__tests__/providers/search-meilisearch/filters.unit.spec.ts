import { MedusaError } from "@medusajs/framework/utils";
import {
  escapeValue,
  toMeiliFilter,
} from "../../../providers/search-meilisearch/utils/filters";

describe("escapeValue", () => {
  it("quotes strings and leaves numbers and booleans bare", () => {
    expect(escapeValue("Men")).toBe('"Men"');
    expect(escapeValue(10)).toBe("10");
    expect(escapeValue(true)).toBe("true");
    expect(escapeValue(false)).toBe("false");
  });

  it("escapes backslashes and quotes", () => {
    expect(escapeValue('a"b')).toBe('"a\\"b"');
    expect(escapeValue("a\\b")).toBe('"a\\\\b"');
    expect(escapeValue("trail\\")).toBe('"trail\\\\"');
  });

  it("passes apostrophes and accents through", () => {
    expect(escapeValue("Men's")).toBe(`"Men's"`);
    expect(escapeValue("Hermès")).toBe('"Hermès"');
  });

  it("rejects dates and non-finite numbers", () => {
    expect(() => escapeValue(new Date())).toThrow(MedusaError);
    expect(() => escapeValue(Number.NaN)).toThrow(MedusaError);
  });
});

describe("toMeiliFilter", () => {
  it("returns undefined for nothing to filter", () => {
    expect(toMeiliFilter(undefined)).toBeUndefined();
    expect(toMeiliFilter({})).toBeUndefined();
    expect(toMeiliFilter({ q: "sauvage" })).toBeUndefined();
    expect(toMeiliFilter({ $and: [] })).toBeUndefined();
  });

  it("translates equality, arrays and booleans", () => {
    expect(toMeiliFilter({ category: "Men" })).toBe('category = "Men"');
    expect(toMeiliFilter({ category: ["Men", "Unisex"] })).toBe(
      'category IN ["Men","Unisex"]',
    );
    expect(toMeiliFilter({ in_stock: true })).toBe("in_stock = true");
    expect(toMeiliFilter({ brand: null })).toBe("brand IS NULL");
  });

  it("ignores q", () => {
    expect(toMeiliFilter({ q: "x", category: "Men" })).toBe('category = "Men"');
  });

  it("joins fields with AND", () => {
    expect(toMeiliFilter({ category: "Men", in_stock: true })).toBe(
      'category = "Men" AND in_stock = true',
    );
  });

  it("translates comparison operators", () => {
    expect(toMeiliFilter({ min_price_usd: { $gte: 10, $lte: 50 } })).toBe(
      "min_price_usd >= 10 AND min_price_usd <= 50",
    );
    expect(toMeiliFilter({ p: { $gt: 1, $lt: 2 } })).toBe("p > 1 AND p < 2");
    expect(toMeiliFilter({ p: { $eq: 3 } })).toBe("p = 3");
  });

  it("translates $ne, $in, $nin, $exists", () => {
    expect(toMeiliFilter({ brand: { $ne: "Dior" } })).toBe('brand != "Dior"');
    expect(toMeiliFilter({ brand: { $in: ["A", "B"] } })).toBe(
      'brand IN ["A","B"]',
    );
    expect(toMeiliFilter({ brand: { $nin: ["A", "B"] } })).toBe(
      'brand NOT IN ["A","B"]',
    );
    expect(toMeiliFilter({ brand: { $exists: true } })).toBe("brand EXISTS");
    expect(toMeiliFilter({ brand: { $exists: false } })).toBe(
      "brand NOT EXISTS",
    );
  });

  it("translates $overlaps and $contains", () => {
    expect(toMeiliFilter({ notes: { $overlaps: ["rose", "oud"] } })).toBe(
      'notes IN ["rose","oud"]',
    );
    expect(toMeiliFilter({ notes: { $contains: "rose" } })).toBe(
      'notes = "rose"',
    );
    expect(toMeiliFilter({ notes: { $contains: ["rose", "oud"] } })).toBe(
      'notes = "rose" AND notes = "oud"',
    );
  });

  it("nests $or, $and and $not with parentheses", () => {
    expect(
      toMeiliFilter({ $or: [{ category: "Men" }, { category: "Unisex" }] }),
    ).toBe('(category = "Men" OR category = "Unisex")');

    expect(
      toMeiliFilter({
        in_stock: true,
        $or: [
          { $and: [{ a: 1 }, { b: 2 }] },
          { c: { $gte: 3, $lte: 4 } },
        ],
      }),
    ).toBe("in_stock = true AND ((a = 1 AND b = 2) OR (c >= 3 AND c <= 4))");

    expect(toMeiliFilter({ $not: { category: "Men" } })).toBe(
      'NOT (category = "Men")',
    );
    expect(toMeiliFilter({ $not: { $or: [{ a: 1 }, { b: 2 }] } })).toBe(
      "NOT (a = 1 OR b = 2)",
    );
  });

  it("fails closed on an empty $or or $not", () => {
    expect(() => toMeiliFilter({ $or: [] })).toThrow(MedusaError);
    expect(() => toMeiliFilter({ $or: [] })).toThrow(/\$or/);
    expect(() => toMeiliFilter({ $not: {} })).toThrow(MedusaError);
    expect(() => toMeiliFilter({ $not: {} })).toThrow(/\$not/);
    expect(() => toMeiliFilter({ $not: { q: "x", a: undefined } })).toThrow(
      /\$not/,
    );
    expect(() =>
      toMeiliFilter({ status: "published", $or: [] }),
    ).toThrow(MedusaError);
  });

  it("treats an $or with an unconstrained branch as unconstrained", () => {
    expect(
      toMeiliFilter({ $or: [{ status: "published" }, {}] }),
    ).toBeUndefined();
    expect(
      toMeiliFilter({ in_stock: true, $or: [{ status: "published" }, {}] }),
    ).toBe("in_stock = true");
    expect(toMeiliFilter({ $or: [{}] })).toBeUndefined();
  });

  it("drops undefined values and empty operator maps as no constraint", () => {
    expect(toMeiliFilter({ brand: undefined })).toBeUndefined();
    expect(toMeiliFilter({ brand: {} })).toBeUndefined();
    expect(toMeiliFilter({ brand: { $eq: undefined } })).toBeUndefined();
    expect(toMeiliFilter({ brand: {}, in_stock: true })).toBe("in_stock = true");
  });

  it("keeps a hostile value inside one quoted literal", () => {
    const hostile = 'x" OR id != "';
    const result = toMeiliFilter({ brand: hostile });

    expect(result).toBe('brand = "x\\" OR id != \\""');
    // Re-read the literal the way Meilisearch does: it must end exactly at the
    // closing quote and decode back to the original value.
    expect(readLiteral(result!.slice('brand = '.length))).toEqual({
      value: hostile,
      rest: "",
    });
  });

  it("does not let a trailing backslash escape the closing quote", () => {
    const result = toMeiliFilter({ brand: 'tail\\' });

    expect(result).toBe('brand = "tail\\\\"');
    expect(readLiteral(result!.slice("brand = ".length))).toEqual({
      value: "tail\\",
      rest: "",
    });

    const combined = toMeiliFilter({ brand: ["a\\", 'b"'], in_stock: true });
    expect(combined).toBe('brand IN ["a\\\\","b\\""] AND in_stock = true');
  });

  it("rejects unsupported operators, dates and bad field names", () => {
    expect(() => toMeiliFilter({ title: { $like: "x" } })).toThrow(
      /\$like/,
    );
    expect(() => toMeiliFilter({ title: { $prefix: "x" } })).toThrow(
      /\$prefix/,
    );
    expect(() => toMeiliFilter({ title: { $like: "x" } })).toThrow(
      MedusaError,
    );
    expect(() => toMeiliFilter({ title: { $bogus: "x" } as any })).toThrow(
      /\$bogus/,
    );
    expect(() => toMeiliFilter({ created_at: new Date() })).toThrow(
      MedusaError,
    );
    expect(() =>
      toMeiliFilter({ created_at: { $gte: new Date() } }),
    ).toThrow(MedusaError);
    expect(() => toMeiliFilter({ 'a" OR b': "x" })).toThrow(MedusaError);
    expect(() => toMeiliFilter({ "a b": "x" })).toThrow(MedusaError);
  });

  it("accepts dotted field paths", () => {
    expect(toMeiliFilter({ "variants.sku": "ABC" })).toBe(
      'variants.sku = "ABC"',
    );
  });
});

/**
 * Reads one double-quoted literal off the front of `input` using Meilisearch's
 * rules: `\` escapes the next character and an unescaped `"` ends the literal.
 */
function readLiteral(input: string): { value: string; rest: string } {
  if (input[0] !== '"') {
    throw new Error("not a quoted literal");
  }

  let value = "";

  for (let i = 1; i < input.length; i++) {
    if (input[i] === "\\") {
      value += input[++i];
    } else if (input[i] === '"') {
      return { value, rest: input.slice(i + 1) };
    } else {
      value += input[i];
    }
  }

  throw new Error("unterminated literal");
}
