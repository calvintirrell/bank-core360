/** Loose equality for questions: case, punctuation and spacing do not matter. */
export function normalizeQuestion(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
