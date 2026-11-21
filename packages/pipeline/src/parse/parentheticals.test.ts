import { describe, expect, test } from 'bun:test';

import { findParentheticalRanges } from './parentheticals';

describe('findParentheticalRanges', () => {
  test('yields balanced round, square, nested, and empty ranges in innermost-first order', () => {
    const input = 'Adam (trained on [ImageNet] for 90 epochs) and ()';

    expect(Array.from(findParentheticalRanges(input))).toEqual([
      { kind: 'square', startIndex: 17, endIndex: 27 },
      { kind: 'round', startIndex: 5, endIndex: 42 },
      { kind: 'round', startIndex: 47, endIndex: 49 },
    ]);
  });

  test.each([
    { name: 'unmatched closing round', input: 'Text with stray ) here.' },
    { name: 'unmatched closing square', input: 'Text with stray ] here.' },
    { name: 'crossed round-square', input: 'Crossed ([brackets)] here.' },
    { name: 'crossed square-round', input: 'Crossed [(brackets]) here.' },
    { name: 'unclosed opening round', input: 'Unclosed (bracket here.' },
    { name: 'unclosed opening square', input: 'Unclosed [bracket here.' },
  ])('discards $name brackets without throwing', ({ input }) => {
    expect(Array.from(findParentheticalRanges(input))).toEqual([]);
  });

  test('preserves closed inner and sibling ranges when outer brackets are crossed or unclosed', () => {
    const input = 'See 1) intro (crossed [inner 1]broken] and (unclosed [inner 2] end.';

    expect(Array.from(findParentheticalRanges(input))).toEqual([
      { kind: 'square', startIndex: 22, endIndex: 31 },
      { kind: 'square', startIndex: 53, endIndex: 62 },
    ]);
  });
});
