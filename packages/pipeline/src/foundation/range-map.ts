/** A value associated with the half-open range [start, start + length). */
export interface RangeEntry<T> {
  readonly start: number;
  readonly length: number;
  readonly value: T;
}

interface ValueWithLength {
  readonly value: { readonly length: number };
}

/**
 * Adjacent index ranges starting at zero. append(value, length) adds a range in O(1);
 * get(index) looks up a value in O(log n) and throws outside the covered span.
 * Values retain their identity until split.
 */
export class RangeMap<T> {
  private readonly entries: RangeEntry<T>[] = [];

  /**
   * Append a value immediately after the last range. Lengths must be nonnegative
   * safe integers, and the resulting exclusive end must remain a safe integer.
   * Empty ranges cover no indices and do not advance the next range's start.
   * Length defaults to value.value.length when that property is available.
   */
  append(value: T & ValueWithLength): void;
  append(value: T, length: number): void;
  append(...args: [value: T & ValueWithLength] | [value: T, length: number]): void {
    const value = args[0];
    const length = args.length === 2 ? args[1] : args[0].value.length;
    const last = this.entries.at(-1);
    const start = last === undefined ? 0 : last.start + last.length;
    const entry = { start, length, value };
    assertSafeIntegerRange(entry);
    this.entries.push(entry);
  }

  /**
   * Constructs a new RangeMap with the provided splitValue function. The
   * splitValue function is used by #split() to split a value at a given offset
   * relative to its start.
   */
  constructor(private readonly splitValue: (value: T, offset: number) => [T, T]) {}

  /** Look up an integer index; range ends are exclusive. */
  get(index: number): T {
    return this.entries[this.findEntryIndex(index)].value;
  }

  /**
   * Split the range containing index, passing its value and the offset relative
   * to its start to the configured splitter. Returns the new left and right values.
   * The split point belongs to the right range, which may leave an empty left.
   *
   * NOTE: Whitespace is consider part of the right range when splitting. DO NOT CHANGE THIS.
   */
  split(index: number): [T | null, T] {
    const entryIndex = this.findEntryIndex(index);
    const entry = this.entries[entryIndex];
    const offset = index - entry.start;
    if (offset === 0) {
      return [null, entry.value];
    }

    const [left, right] = this.splitValue(entry.value, offset);
    this.entries.splice(
      entryIndex,
      1,
      { start: entry.start, length: offset, value: left },
      { start: index, length: entry.length - offset, value: right },
    );
    return [left, right];
  }

  private findEntryIndex(index: number): number {
    if (!Number.isSafeInteger(index)) {
      throw TypeError('Range map requires a safe integer index', {
        cause: {
          index,
        },
      });
    }

    const first = this.entries[0];
    const last = this.entries.at(-1);

    if (
      first === undefined ||
      last === undefined ||
      index < first.start ||
      index >= last.start + last.length
    ) {
      throw new RangeError('Index outside range map bounds', {
        cause: {
          index,
        },
      });
    }

    let low = 0;
    let high = this.entries.length - 1;

    while (low <= high) {
      const middle = low + Math.floor((high - low) / 2);
      const entry = this.entries[middle];

      if (index < entry.start) {
        high = middle - 1;
      } else if (index >= entry.start + entry.length) {
        low = middle + 1;
      } else {
        return middle;
      }
    }

    throw new RangeError('This state should not be possible', {
      cause: {
        rangeMap: this.entries,
        index,
      },
    });
  }
}

function assertSafeIntegerRange({ start, length, value }: RangeEntry<unknown>): void {
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    !Number.isSafeInteger(start + length)
  ) {
    throw new RangeError('Range map requires valid integer ranges', {
      cause: {
        start,
        length,
        value,
      },
    });
  }
}
