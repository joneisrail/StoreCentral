// Escapes LIKE/ILIKE wildcards so user input matches literally.
export function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`)
}
