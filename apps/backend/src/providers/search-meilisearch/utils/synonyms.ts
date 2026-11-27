/**
 * Fragrance synonym groups. Each group is written once and expanded so every
 * member lists all the others, which is the shape Meilisearch expects.
 * Terms are lowercase; multi-word terms are allowed.
 */
const GROUPS: string[][] = [
  ["edp", "eau de parfum"],
  ["edt", "eau de toilette"],
  ["edc", "eau de cologne"],
  ["ysl", "yves saint laurent"],
  ["cdg", "comme des garcons"],
  ["mfk", "maison francis kurkdjian"],
  ["jpg", "jean paul gaultier"],
  ["ck", "calvin klein"],
  ["d&g", "dolce & gabbana", "dolce and gabbana"],
  ["30ml", "1oz", "1 oz", "1.0oz"],
  ["50ml", "1.7oz", "1.7 oz"],
  ["100ml", "3.4oz", "3.4 oz"],
  ["perfume", "parfum", "fragrance"],
  ["cologne", "aftershave"],
];

function expand(groups: string[][]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const group of groups) {
    for (const term of group) {
      if (term in result) {
        throw new Error(`Duplicate synonym term "${term}".`);
      }
      result[term] = group.filter((other) => other !== term);
    }
  }
  return result;
}

export const SYNONYMS: Record<string, string[]> = expand(GROUPS);
