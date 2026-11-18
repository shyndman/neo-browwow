import { describe, expect, test } from 'bun:test';

import { splitWords } from './strings';

describe('splitWords', () => {
  test('extracts non-whitespace words and returns empty array for blank strings', () => {
    expect(splitWords('  alpha  beta\ngamma ')).toEqual(['alpha', 'beta', 'gamma']);
    expect(splitWords(' \n\t ')).toEqual([]);
  });
});
