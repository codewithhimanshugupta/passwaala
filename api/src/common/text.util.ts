/**
 * Text normalization helpers for user-entered names.
 *
 * Names (people, products, shops, categories, cities) are stored Title Cased so
 * they display consistently no matter how the user typed them: "ravi gupta" →
 * "Ravi Gupta", "surf excel matic 1kg" → "Surf Excel Matic 1kg". Applied
 * server-side at save time so every app benefits without client changes.
 */

/**
 * Title-case a free-text name. Trims + collapses inner whitespace, upper-cases
 * the first letter of each whitespace/hyphen/slash-separated word, lower-cases
 * the rest. Preserves separators. Leaves tokens that contain a digit as-typed
 * (so units/model codes like "1kg", "5L", "iPhone12" aren't mangled).
 */
export function titleCaseName(input: string | null | undefined): string {
  if (!input) return '';
  const collapsed = input.trim().replace(/\s+/g, ' ');
  if (!collapsed) return '';
  // Split on spaces but keep hyphens/slashes handled within each word too.
  return collapsed
    .split(' ')
    .map((word) => titleCaseToken(word))
    .join(' ');
}

/** Title-case one space-delimited token, recursing into hyphen/slash parts. */
function titleCaseToken(token: string): string {
  // Recurse on hyphen and slash so "fruits-veg" → "Fruits-Veg", "a/b" → "A/B".
  for (const sep of ['-', '/']) {
    if (token.includes(sep)) {
      return token
        .split(sep)
        .map((part) => titleCaseToken(part))
        .join(sep);
    }
  }
  if (!token) return token;
  // Tokens with a digit (units, model codes) keep their original casing.
  if (/\d/.test(token)) return token;
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}
