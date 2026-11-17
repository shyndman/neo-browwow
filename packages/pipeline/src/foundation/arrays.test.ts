import { describe, expect, test } from 'bun:test';

import { replace } from './arrays';

describe('replace', () => {
  test('replaces the first occurrence in place with multiple items', () => {
    const values = ['before', 'needle', 'after', 'needle'];
    const original = values;

    replace(values, 'needle', 'left', 'right');

    expect(values).toBe(original);
    expect(values).toEqual(['before', 'left', 'right', 'after', 'needle']);
  });

  test('replaces items at either end', () => {
    const values = [1, 2, 3];

    replace(values, 1, 4);
    replace(values, 3, 5);

    expect(values).toEqual([4, 2, 5]);
  });

  test('removes the item when no replacements are provided', () => {
    const values = [1, 2, 3];

    replace(values, 2);

    expect(values).toEqual([1, 3]);
  });

  test('matches objects by identity', () => {
    const needle = { value: 1 };
    const equalValue = { value: 1 };
    const replacement = { value: 2 };
    const values = [equalValue, needle];

    replace(values, needle, replacement);

    expect(values[0]).toBe(equalValue);
    expect(values[1]).toBe(replacement);
  });

  test('throws without modifying the array when the item is absent', () => {
    const values = [1, 2, 3];

    expect(() => replace(values, 4, 5)).toThrow();
    expect(values).toEqual([1, 2, 3]);
  });

  test('throws when the array is empty', () => {
    const values: number[] = [];

    expect(() => replace(values, 1, 2)).toThrow();
    expect(values).toEqual([]);
  });
});
