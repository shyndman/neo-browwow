/**
 * Replaces the first occurrence of needle in place, using indexOf equality.
 * Throws if needle is absent; no replacements removes it.
 */
export function replace<T>(haystack: T[], needle: T, ...replacements: T[]): void {
  const index = haystack.indexOf(needle);
  if (index === -1) {
    throw new Error('Expected to find needle in haystack', {
      cause: { needle, haystack },
    });
  }
  haystack.splice(index, 1, ...replacements);
}
