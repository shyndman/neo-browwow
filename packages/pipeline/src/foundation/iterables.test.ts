import { describe, expect, test } from 'bun:test';

import { isSorted, isSortedAscending, isSortedDescending, withIsLast } from './iterables';

describe('withIsLast', () => {
  test('handles empty and singleton iterables', () => {
    expect(Array.from(withIsLast([]))).toEqual([]);
    expect(Array.from(withIsLast([undefined]))).toEqual([[undefined, true]]);
  });

  test('marks only the final value and supports repeated iteration', () => {
    const values = withIsLast([1, undefined, 3]);
    const expected: [number | undefined, boolean][] = [
      [1, false],
      [undefined, false],
      [3, true],
    ];

    expect(Array.from(values)).toEqual(expected);
    expect(Array.from(values)).toEqual(expected);
  });

  test('defers consumption, looks ahead by one, and closes on early exit', () => {
    const consumed: number[] = [];
    let closed = false;

    function* source(): Generator<number, void, void> {
      try {
        for (let value = 0; ; value++) {
          consumed.push(value);
          yield value;
        }
      } finally {
        closed = true;
      }
    }

    const values = withIsLast(source());
    expect(consumed).toEqual([]);

    let index = 0;
    for (const value of values) {
      expect(value).toEqual([index, false]);
      expect(consumed.length).toBe(index + 2);
      if (++index === 2) {
        break;
      }
    }

    expect(consumed).toEqual([0, 1, 2]);
    expect(closed).toBe(true);
  });
});

interface SortedCase {
  readonly name: string;
  readonly values: number[];
  readonly ascending: boolean;
  readonly descending: boolean;
  readonly sorted: boolean;
}

const compareNumbers = (a: number, b: number): number => a - b;

const cases: SortedCase[] = [
  {
    name: 'empty',
    values: [],
    ascending: true,
    descending: true,
    sorted: true,
  },
  {
    name: 'singleton',
    values: [2],
    ascending: true,
    descending: true,
    sorted: true,
  },
  {
    name: 'equal neighbors',
    values: [2, 2, 2],
    ascending: true,
    descending: true,
    sorted: true,
  },
  {
    name: 'ascending with duplicates',
    values: [-1, 0, 0, 3],
    ascending: true,
    descending: false,
    sorted: true,
  },
  {
    name: 'descending with duplicates',
    values: [3, 0, 0, -1],
    ascending: false,
    descending: true,
    sorted: true,
  },
  {
    name: 'two ascending elements',
    values: [1, 2],
    ascending: true,
    descending: false,
    sorted: true,
  },
  {
    name: 'two descending elements',
    values: [2, 1],
    ascending: false,
    descending: true,
    sorted: true,
  },
  {
    name: 'peak',
    values: [1, 3, 2],
    ascending: false,
    descending: false,
    sorted: false,
  },
  {
    name: 'valley',
    values: [3, 1, 2],
    ascending: false,
    descending: false,
    sorted: false,
  },
  {
    name: 'late ascending violation',
    values: [1, 2, 3, 0],
    ascending: false,
    descending: false,
    sorted: false,
  },
  {
    name: 'late descending violation',
    values: [3, 2, 1, 4],
    ascending: false,
    descending: false,
    sorted: false,
  },
];

describe('sorted predicates', () => {
  for (const { name, values, ascending, descending, sorted } of cases) {
    test(name, () => {
      expect(isSortedAscending(values, compareNumbers)).toBe(ascending);
      expect(isSortedDescending(values, compareNumbers)).toBe(descending);
      expect(isSorted(values, compareNumbers)).toBe(sorted);
    });
  }

  test('uses comparator ordering and fractional results for objects', () => {
    const low = { rank: 1 };
    const middle = { rank: 2 };
    const high = { rank: 3 };
    const compareRanks = (a: typeof low, b: typeof low): number => (b.rank - a.rank) / 2;

    expect(isSortedAscending([high, middle, low], compareRanks)).toBe(true);
    expect(isSortedAscending([low, middle, high], compareRanks)).toBe(false);
    expect(isSortedDescending([low, middle, high], compareRanks)).toBe(true);
    expect(isSortedDescending([high, middle, low], compareRanks)).toBe(false);
    expect(isSorted([low, middle, high], compareRanks)).toBe(true);
    expect(isSorted([high, low, middle], compareRanks)).toBe(false);
  });

  test('accepts single-pass iterables in either direction', () => {
    expect(isSortedAscending(new Set([1, 2, 3]).values(), compareNumbers)).toBe(true);
    expect(isSortedDescending(new Set([3, 2, 1]).values(), compareNumbers)).toBe(true);
  });

  for (const [name, check, values] of [
    ['ascending', isSortedAscending<number>, [2, 1, 0]],
    ['descending', isSortedDescending<number>, [1, 2, 3]],
  ] as const) {
    test(`${name} stops at the first violation and closes the source`, () => {
      const consumed: number[] = [];
      let closed = false;

      function* source(): Generator<number, void, void> {
        try {
          for (const value of values) {
            consumed.push(value);
            yield value;
          }
        } finally {
          closed = true;
        }
      }

      expect(check(source(), compareNumbers)).toBe(false);
      expect(consumed).toEqual(values.slice(0, 2));
      expect(closed).toBe(true);
    });
  }
});
