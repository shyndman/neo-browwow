/** A half-open character offset interval `[startIndex, endIndex)`. */
export interface TextRange {
  startIndex: number;
  endIndex: number;
}

/**
 * Splits a string into two parts at the specified index.
 * @param str The string to split.
 * @param index The index at which to split the string.
 * @returns A tuple containing the two parts of the string.
 * @throws {RangeError} If the index is out of bounds.
 */
export function splitAtIndex(str: string, index: number): [string, string] {
  if (index < 0 || index > str.length) {
    throw new RangeError('Index out of bounds', {
      cause: {
        str,
        index,
      },
    });
  }
  return [str.slice(0, index), str.slice(index)];
}

/**
 * Returns the appropriate plural form of a word based on the count.
 * @param countable An object with a length property representing the count.
 * @param singular The singular form of the word.
 * @param pluralForm The plural form of the word (optional). If not provided, defaults to adding 's' to the singular form.
 * @returns The singular or plural form of the word based on the count.
 */
export function plural(countable: { length: number }, singular: string, pluralForm?: string): string {
  const count = countable.length;
  if (count === 1) {
    return singular;
  }
  return pluralForm ?? `${singular}s`;
}

/**
 * Splits `str` into non-whitespace words.
 */
export function splitWords(str: string): string[] {
  return str.match(/\S+/gu) ?? [];
}
