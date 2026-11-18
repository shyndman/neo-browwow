import { getLogger } from '@logtape/logtape';

import type { TextRange } from './foundation/strings';
import type { ParentheticalKind } from './mdast';

const logger = getLogger(['browwow', 'pipeline', 'parentheticals']);

export interface ParentheticalRange extends TextRange {
  kind: ParentheticalKind;
}

interface OpenBracket {
  kind: ParentheticalKind;
  startIndex: number;
}

/**
 * Yields balanced `(...)` and `[...]` ranges in plain paragraph text in
 * innermost-first closing order, warning and discarding unmatched, crossed, or unclosed brackets.
 */
export function* findParentheticalRanges(text: string): Generator<ParentheticalRange, void, undefined> {
  const stack: OpenBracket[] = [];

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '(' || char === '[') {
      stack.push({ kind: char === '(' ? 'round' : 'square', startIndex: i });
      continue;
    }

    if (char !== ')' && char !== ']') {
      continue;
    }

    const expectedKind: ParentheticalKind = char === ')' ? 'round' : 'square';
    const open = stack.pop();

    if (open === undefined) {
      logger.warn('Ignoring unmatched closing bracket "{char}" at index {index}.', { char, index: i, text });
      continue;
    }

    if (open.kind !== expectedKind) {
      logger.warn('Discarding open brackets due to crossed closing bracket "{char}" at index {index}.', {
        char,
        index: i,
        openKind: open.kind,
        openIndex: open.startIndex,
        text,
      });
      stack.length = 0;
      continue;
    }

    yield { kind: open.kind, startIndex: open.startIndex, endIndex: i + 1 };
  }

  if (stack.length > 0) {
    logger.warn('Discarding {count} unclosed opening bracket(s) at end of paragraph.', {
      count: stack.length,
      text,
    });
  }
}
