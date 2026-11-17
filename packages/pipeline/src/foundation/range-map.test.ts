import { describe, expect, test } from 'bun:test';
import { RangeMap } from './range-map';

const splitString = (value: string, offset: number): [string, string] => [
  value.slice(0, offset),
  value.slice(offset),
];

describe('RangeMap', () => {
  test('infers lengths from string values and preserves ranges after value mutation', () => {
    const splitValue = (node: { value: string }, offset: number): [{ value: string }, { value: string }] => [
      { value: node.value.slice(0, offset) },
      { value: node.value.slice(offset) },
    ];
    const map = new RangeMap(splitValue);
    const empty = { value: '' };
    const first = { value: 'ab' };
    const second = { value: 'cde' };
    map.append(empty);
    map.append(first);
    first.value = 'longer text';
    map.append(second);

    expect(map.get(0)).toBe(first);
    expect(map.get(1)).toBe(first);
    expect(map.get(2)).toBe(second);
    expect(map.get(4)).toBe(second);
    expect(() => map.get(5)).toThrow(RangeError);
    expect(map.split(3)).toEqual([{ value: 'c' }, { value: 'de' }]);
  });

  test('infers lengths from array values and accepts an explicit override of zero', () => {
    const splitValue = (node: { value: number[] }): [{ value: number[] }, { value: number[] }] => [
      node,
      node,
    ];
    const map = new RangeMap(splitValue);
    const empty = { value: [1, 2, 3] };
    const first = { value: [4, 5] };
    map.append(empty, 0);
    map.append(first);

    expect(map.get(0)).toBe(first);
    expect(map.get(1)).toBe(first);
    expect(() => map.get(2)).toThrow(RangeError);
  });

  test('requires an explicit length for values without value.length', () => {
    const splitValue = (node: { name: string }): [{ name: string }, { name: string }] => [node, node];
    const map = new RangeMap(splitValue);
    const node = { name: 'first' };

    expect(() => {
      // @ts-expect-error Values without value.length require an explicit length.
      map.append(node);
    }).toThrow(TypeError);
    map.append(node, 2);
    expect(map.get(1)).toBe(node);
  });

  test('rejects inferred invalid lengths without advancing the next range', () => {
    const splitValue = (node: { value: { length: number } }): [typeof node, typeof node] => [node, node];
    const map = new RangeMap(splitValue);
    const node = { value: { length: 2 } };

    expect(() => map.append({ value: { length: -1 } })).toThrow(RangeError);
    map.append(node);
    expect(map.get(0)).toBe(node);
    expect(map.get(1)).toBe(node);
    expect(() => map.get(2)).toThrow(RangeError);
  });

  for (const length of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    test(`rejects invalid length ${length} without advancing the next range`, () => {
      const map = new RangeMap(splitString);
      map.append('first', 2);

      expect(() => map.append('invalid', length)).toThrow(RangeError);
      map.append('second', 3);

      expect(map.get(1)).toBe('first');
      expect(map.get(2)).toBe('second');
      expect(map.get(4)).toBe('second');
      expect(() => map.get(5)).toThrow(RangeError);
    });
  }

  test('looks up adjacent half-open ranges as values are appended', () => {
    const map = new RangeMap(splitString);
    map.append('first', 2);

    expect(map.get(0)).toBe('first');
    expect(map.get(1)).toBe('first');
    expect(() => map.get(2)).toThrow(RangeError);

    map.append('second', 3);

    expect(map.get(0)).toBe('first');
    expect(map.get(1)).toBe('first');
    expect(map.get(2)).toBe('second');
    expect(map.get(4)).toBe('second');
    expect(() => map.get(5)).toThrow(RangeError);
  });

  test('skips empty ranges at the start, shared boundary, and end', () => {
    const map = new RangeMap(splitString);
    map.append('empty start', 0);
    map.append('first', 2);
    map.append('empty boundary', 0);
    map.append('another empty boundary', 0);
    map.append('second', 3);
    map.append('empty end', 0);

    expect(() => map.get(-1)).toThrow(RangeError);
    expect(map.get(0)).toBe('first');
    expect(map.get(1)).toBe('first');
    expect(map.get(2)).toBe('second');
    expect(map.get(3)).toBe('second');
    expect(map.get(4)).toBe('second');
    expect(() => map.get(5)).toThrow(RangeError);

    map.append('third', 1);
    expect(map.get(5)).toBe('third');
    expect(() => map.get(6)).toThrow(RangeError);
  });

  test('covers no indices when all ranges are empty', () => {
    const map = new RangeMap(splitString);
    map.append('first empty', 0);
    map.append('second empty', 0);
    map.append('third empty', 0);

    expect(() => map.get(-1)).toThrow(RangeError);
    expect(() => map.get(0)).toThrow(RangeError);
    expect(() => map.get(1)).toThrow(RangeError);
  });

  test('throws for an empty map, out-of-bounds indices, and invalid indices', () => {
    const map = new RangeMap(splitString);

    expect(() => map.get(0)).toThrow(RangeError);
    map.append('first', 2);

    expect(() => map.get(-1)).toThrow(RangeError);
    expect(() => map.get(2)).toThrow(RangeError);
    expect(() => map.get(0.5)).toThrow(TypeError);
    expect(() => map.get(NaN)).toThrow(TypeError);
    expect(() => map.get(Infinity)).toThrow(TypeError);
  });

  test('accepts the largest safe end and rejects overflow without changing ranges', () => {
    const map = new RangeMap(splitString);
    map.append('first', Number.MAX_SAFE_INTEGER - 1);
    map.append('last', 1);

    expect(() => map.append('overflow', 1)).toThrow(RangeError);
    map.append('empty end', 0);

    expect(map.get(Number.MAX_SAFE_INTEGER - 2)).toBe('first');
    expect(map.get(Number.MAX_SAFE_INTEGER - 1)).toBe('last');
    expect(() => map.get(Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
  });

  test('preserves value identity without deriving ranges from mutable values', () => {
    const splitValue = (value: { name: string }): [{ name: string }, { name: string }] => [value, value];
    const map = new RangeMap(splitValue);
    const first = { name: 'first' };
    const second = { name: 'second' };
    map.append(first, 2);
    first.name = 'longer name';
    map.append(second, 3);

    expect(map.get(0)).toBe(first);
    expect(map.get(1)).toBe(first);
    expect(map.get(2)).toBe(second);
    expect(map.get(4)).toBe(second);
    expect(() => map.get(5)).toThrow(RangeError);
  });
});

describe('RangeMap.split', () => {
  test('splits at an absolute index and updates both ranges', () => {
    const map = new RangeMap(splitString);
    map.append('one', 3);
    map.append('abcdef', 6);
    map.append('two', 3);

    expect(map.split(6)).toEqual(['abc', 'def']);
    expect(map.get(2)).toBe('one');
    expect(map.get(3)).toBe('abc');
    expect(map.get(5)).toBe('abc');
    expect(map.get(6)).toBe('def');
    expect(map.get(8)).toBe('def');
    expect(map.get(9)).toBe('two');
  });

  test('can split the resulting ranges repeatedly in either direction', () => {
    const map = new RangeMap(splitString);
    map.append('abcdefgh', 8);

    expect(map.split(5)).toEqual(['abcde', 'fgh']);
    expect(map.split(2)).toEqual(['ab', 'cde']);
    expect(map.split(7)).toEqual(['fg', 'h']);
    expect(Array.from({ length: 8 }, (_, index) => map.get(index))).toEqual([
      'ab',
      'ab',
      'cde',
      'cde',
      'cde',
      'fg',
      'fg',
      'h',
    ]);
  });

  test('supports splitting at a range start, including repeated splits', () => {
    const map = new RangeMap(splitString);
    map.append('one', 3);
    map.append('ab', 2);

    expect(map.split(3)).toEqual([null, 'ab']);
    expect(map.split(3)).toEqual([null, 'ab']);
    expect(map.get(2)).toBe('one');
    expect(map.get(3)).toBe('ab');
    expect(map.get(4)).toBe('ab');
    null;
  });

  test('leaves ranges unchanged if the split fails', () => {
    const map = new RangeMap<string>(() => {
      throw new Error('split failed');
    });
    map.append('abc', 3);

    expect(() => map.split(3)).toThrow(RangeError);
    expect(() => map.split(0.5)).toThrow(TypeError);
    expect(() => map.split(1)).toThrow('split failed');
    expect(map.get(0)).toBe('abc');
    expect(map.get(2)).toBe('abc');
  });

  test('splitting at zero returns the first covered value without splitting it', () => {
    const map = new RangeMap<string>(() => {
      throw new Error('splitter should not be called');
    });
    map.append('empty', 0);
    map.append('abc', 3);

    expect(map.split(0)).toEqual([null, 'abc']);
    expect(map.split(0)).toEqual([null, 'abc']);
    expect(map.get(0)).toBe('abc');
  });

  test('rejects splitting at zero when no range covers it', () => {
    const map = new RangeMap(splitString);
    expect(() => map.split(0)).toThrow(RangeError);

    map.append('empty', 0);
    expect(() => map.split(0)).toThrow(RangeError);
  });

  test('appends after splitting the last range without shifting existing indices', () => {
    const map = new RangeMap(splitString);
    map.append('abcd', 4);

    expect(map.split(2)).toEqual(['ab', 'cd']);
    map.append('ef', 2);

    expect(map.get(1)).toBe('ab');
    expect(map.get(2)).toBe('cd');
    expect(map.get(3)).toBe('cd');
    expect(map.get(4)).toBe('ef');
    expect(map.get(5)).toBe('ef');
    expect(() => map.get(6)).toThrow(RangeError);
    expect(map.split(5)).toEqual(['e', 'f']);
  });
});
