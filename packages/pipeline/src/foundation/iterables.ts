/**
 * Lazily yields adjacent pairs from an iterable.
 */
export function* pairs<T>(iterable: Iterable<T>): Generator<[T, T], void, void> {
  for (const w of windows(iterable, 2)) {
    yield [w[0], w[1]];
  }
}

/**
 * Lazily yields sliding windows of the specified size from the iterable.
 */
export function* windows<T>(iterable: Iterable<T>, size: number): Generator<T[], void, void> {
  const buffer: T[] = [];
  for (const item of iterable) {
    buffer.push(item);
    if (buffer.length === size) {
      yield buffer.slice();
      buffer.shift();
    }
  }
}

/**
 * Lazily groups elements of an iterable into non-overlapping batches of up to `size` items.
 * @throws {RangeError} If `size` is not a positive safe integer.
 */
export function* batch<T>(iterable: Iterable<T>, size: number): Generator<T[], void, void> {
  if (!Number.isSafeInteger(size) || size < 1) {
    throw new RangeError('Batch size must be a positive safe integer', {
      cause: { size },
    });
  }

  let current: T[] = [];
  for (const item of iterable) {
    current.push(item);
    if (current.length === size) {
      yield current;
      current = [];
    }
  }

  if (current.length > 0) {
    yield current;
  }
}

/**
 * Yields the elements of an iterable in reverse order.
 * Consumes the iterable into an array before yielding.
 * Use with caution on large iterables.
 */
export function reversed<T>(iterable: Iterable<T>): Iterable<T> {
  return {
    *[Symbol.iterator]() {
      const array = Array.from(iterable);
      for (let i = array.length - 1; i >= 0; i--) {
        yield array[i];
      }
    },
  };
}

/**
 * Lazily chains multiple iterables into a single iterable.
 */
export function chain<T>(...iterables: Iterable<T>[]): Iterable<T> {
  return {
    *[Symbol.iterator]() {
      for (const iterable of iterables) {
        yield* iterable;
      }
    },
  };
}

/**
 * Lazily pairs each value with whether it is last, using one-item lookahead.
 */
export function withIsLast<T>(iterable: Iterable<T>): Iterable<[T, boolean]> {
  return {
    *[Symbol.iterator]() {
      let previous!: T;
      let hasPrevious = false;

      for (const current of iterable) {
        if (hasPrevious) {
          yield [previous, false];
        }

        previous = current;
        hasPrevious = true;
      }

      if (hasPrevious) {
        yield [previous, true];
      }
    },
  };
}

/**
 * Returns a negative number, zero, or a positive number when a is
 * less than, equal to, or greater than b, respectively.
 */
export type Comparator<T> = (a: T, b: T) => number;

/**
 * Returns whether the array is nondecreasing or nonincreasing under the comparator.
 * Equal neighbors are allowed; empty and single-element arrays are sorted.
 */
export function isSorted<T>(arr: T[], comparator: Comparator<T>): boolean {
  return isSortedAscending(arr, comparator) || isSortedDescending(arr, comparator);
}

/**
 * Returns whether the iterable is nondecreasing under the comparator.
 * Equal neighbors are allowed; empty and single-element iterables are sorted.
 * Consumes the iterable until the first out-of-order pair or exhaustion.
 */
export function isSortedAscending<T>(iterable: Iterable<T>, comparator: Comparator<T>): boolean {
  return pairs(iterable).every(([a, b]) => comparator(a, b) <= 0);
}

/**
 * Returns whether the iterable is nonincreasing under the comparator.
 * Equal neighbors are allowed; empty and single-element iterables are sorted.
 * Consumes the iterable until the first out-of-order pair or exhaustion.
 */
export function isSortedDescending<T>(iterable: Iterable<T>, comparator: Comparator<T>): boolean {
  return pairs(iterable).every(([a, b]) => comparator(a, b) >= 0);
}
