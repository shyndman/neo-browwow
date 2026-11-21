import { getLogger } from '@logtape/logtape';
import type { Paragraph, Parent, Root, Text } from 'mdast';
import { remark } from 'remark';
import remarkDirective from 'remark-directive';
import remarkExtendedTable from 'remark-extended-table';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { visit } from 'unist-util-visit';
import { visitParents } from 'unist-util-visit-parents';
import type { VFile } from 'vfile';

import { TextMetadata, type TextSpan } from '../ast';
import * as arrays from '../foundation/arrays';
import * as iterables from '../foundation/iterables';
import { findCommonAncestor, isTextNode, splitTextNode } from '../foundation/mdast';
import { RangeMap } from '../foundation/range-map';
import type { TextRange } from '../foundation/strings';
import { findParentheticalRanges, type ParentheticalRange } from './parentheticals';
import { findSentenceDelimiters } from './sentence-splitter/index';

const logger = getLogger(['browwow', 'pipeline', 'parse']);

/**
 * Parses a Markdown `VFile` into an mdast `Root` tree, runs syntax plugins,
 * and annotates every paragraph's `Text` leaves with `Parenthetical` and
 * `Sentence` span metadata for downstream speech preparation.
 */
export async function parseFile(markdownFile: VFile): Promise<Root> {
  const source = prepareSource(markdownFile.value);
  const sourceLabel = markdownFile.path || '<inline>';

  logger.debug('Parsing Markdown source {sourceLabel} ({charCount} chars).', {
    sourceLabel,
    charCount: source.length,
  });

  const parser = remark()
    .use(remarkMath)
    .use(remarkGfm)
    // For colspan and rowspan support
    .use(remarkExtendedTable)
    .use(remarkDirective);

  const tree = parser.parse(source);
  await parser.run(tree);

  // Identify parts of text important to its pronunciation
  processParagraphs(tree);

  logger.info('Parsed Markdown tree for {sourceLabel} ({childCount} root children).', {
    sourceLabel,
    childCount: tree.children.length,
  });

  return tree;
}

/**
 * Normalizes raw Markdown bytes or text into a plain UTF-8 string with ASCII
 * spaces and straight quotes so downstream text scanners and TTS engines do
 * not have to special-case non-breaking spaces or typographic curly quotes.
 */
function prepareSource(value: Uint8Array | string): string {
  return (
    (value instanceof Uint8Array ? new TextDecoder('utf-8').decode(value) : value)
      .replaceAll('\u00A0', ' ')
      // Get rid of fancy quotes -- they confuse TTS engines, and are of limited usefulness to
      .replaceAll(/[“”]/gu, '"')
      .replaceAll(/[‘’]/gu, "'")
  );
}

/**
 * Pairs a `Text` leaf with its root-to-parent AST ancestor chain inside a
 * paragraph's `RangeMap`.
 */
interface ParagraphLeaf {
  node: Text;
  ancestors: readonly Parent[];
}

/**
 * Pairs a paragraph's flattened plain text (`paragraphText`) with the
 * `RangeMap` indexing its underlying AST `Text` leaves and ancestor chains.
 */
interface ParagraphContext {
  paragraphText: string;
  leafRanges: RangeMap<ParagraphLeaf>;
}

/**
 * Annotates every paragraph in `tree` with `Parenthetical` and `Sentence`
 * endpoint metadata by splitting `Text` leaves in place at span boundaries.
 *
 * Parenthetical and sentence scanners operate on a flat plain-text string
 * (`[startIndex, endIndex)` character offsets), while speech preparation needs
 * those spans attached to `Text` leaves inside a nested Markdown paragraph
 * (`emphasis`, `strong`, `link`) without splitting formatting nodes. Each
 * paragraph indexes its `Text` leaves in a `RangeMap<ParagraphLeaf>`, splits
 * the boundary leaves at each span's start and end offsets, and attaches the
 * resulting `TextSpan` to `start` and `end`.
 */
function processParagraphs(tree: Root): void {
  let paragraphCount = 0;
  let parentheticalCount = 0;
  let sentenceCount = 0;

  visit(tree, 'paragraph', (paragraph) => {
    paragraphCount += 1;

    const ctx = indexParagraph(paragraph);
    if (ctx.paragraphText.length === 0) {
      logger.debug('Skipping paragraph with no text leaves.');
      return;
    }

    const parentheticalRanges = Array.from(findParentheticalRanges(ctx.paragraphText));
    for (const range of parentheticalRanges) {
      TextMetadata.attach({
        type: 'parenthetical',
        kind: range.kind,
        ...splitSpan(ctx, range),
      });
      parentheticalCount += 1;
    }

    for (const range of findSentenceRanges(ctx.paragraphText, parentheticalRanges)) {
      TextMetadata.attach({
        type: 'sentence',
        ...splitSpan(ctx, range),
      });
      sentenceCount += 1;
    }
  });

  logger.debug(
    'Annotated {paragraphCount} paragraph(s) with {parentheticalCount} parenthetical and {sentenceCount} sentence span(s).',
    {
      paragraphCount,
      parentheticalCount,
      sentenceCount,
    },
  );
}

/**
 * Flattens all `Text` leaves under `paragraph` into a single contiguous string
 * (`paragraphText`) while indexing each leaf and its AST ancestor chain in `leafRanges`.
 */
function indexParagraph(paragraph: Paragraph): ParagraphContext {
  let paragraphText = '';
  let leafCount = 0;
  const leafRanges = new RangeMap<ParagraphLeaf>(splitParagraphLeaf);

  visitParents(paragraph, isTextNode, (node, ancestors) => {
    leafRanges.append({ node, ancestors }, node.value.length);
    paragraphText += node.value;
    leafCount += 1;
  });

  logger.debug('Indexed paragraph ({charCount} chars across {leafCount} text leaves).', {
    charCount: paragraphText.length,
    leafCount,
  });

  return { paragraphText, leafRanges };
}

/**
 * Splits a `ParagraphLeaf` at `offset` into two sibling `Text` leaves in its
 * parent's `children` array (migrating any existing `TextMetadata` endpoints)
 * and returns the two new `ParagraphLeaf` records sharing the same ancestor chain.
 */
function splitParagraphLeaf(leaf: ParagraphLeaf, offset: number): [ParagraphLeaf, ParagraphLeaf] {
  const parent = leaf.ancestors.at(-1);
  if (parent === undefined) {
    throw new Error("Illegal state encountered. Expected to find leaf text in its parent's children.", {
      cause: { offset, leaf },
    });
  }

  const [leftNode, rightNode] = splitTextNode(leaf.node, offset);
  arrays.replace(parent.children, leaf.node, leftNode, rightNode);

  logger.debug('Split text leaf at offset {offset} into "{leftText}" and "{rightText}".', {
    offset,
    leftText: leftNode.value,
    rightText: rightNode.value,
  });

  return [
    { node: leftNode, ancestors: leaf.ancestors },
    { node: rightNode, ancestors: leaf.ancestors },
  ];
}

/**
 * Projects a plain-text character `range` onto `ctx.leafRanges` — splitting the
 * `Text` leaves at `range.endIndex` and `range.startIndex` so the span lands
 * on exact leaf boundaries — and returns the span's `commonAncestor`, `start`,
 * `end`, and `text`.
 */
function splitSpan(ctx: ParagraphContext, range: TextRange): Omit<TextSpan, 'type'> {
  if (range.endIndex < ctx.paragraphText.length) {
    ctx.leafRanges.split(range.endIndex);
  }

  const [, startLeaf] = ctx.leafRanges.split(range.startIndex);
  const endLeaf = ctx.leafRanges.get(range.endIndex - 1);
  const commonAncestor = findCommonAncestor(startLeaf.ancestors, endLeaf.ancestors);
  const text = ctx.paragraphText.slice(range.startIndex, range.endIndex);

  logger.debug('Resolved span [{startIndex}, {endIndex}) under {commonAncestorType}: "{text}".', {
    startIndex: range.startIndex,
    endIndex: range.endIndex,
    commonAncestorType: commonAncestor.type,
    text,
  });

  return {
    commonAncestor,
    start: startLeaf.node,
    end: endLeaf.node,
    text,
  };
}

/**
 * Computes `[startIndex, endIndex)` character ranges for every sentence in
 * `paragraphText` while respecting parenthetical boundaries.
 *
 * Because `parentheticalRanges` are ordered innermost-first, each parenthetical
 * claims any sentence delimiters strictly inside its bounds — yielding inner
 * sentence ranges when a parenthetical spans multiple sentences and removing
 * those delimiters so they do not split enclosing parentheticals or the host
 * paragraph. Any delimiters left over split the top-level paragraph text.
 */
function* findSentenceRanges(
  paragraphText: string,
  parentheticalRanges: readonly ParentheticalRange[],
): Generator<TextRange, void, undefined> {
  let remainingSplits = Array.from(findSentenceDelimiters(paragraphText));

  logger.debug(
    'Found {delimiterCount} sentence delimiter(s) across {parentheticalCount} parenthetical range(s).',
    {
      delimiterCount: remainingSplits.length,
      parentheticalCount: parentheticalRanges.length,
    },
  );

  for (const range of parentheticalRanges) {
    const innerSplits = remainingSplits.filter((split) => split > range.startIndex && split < range.endIndex);

    if (innerSplits.length > 0) {
      logger.debug(
        'Partitioning {kind} parenthetical [{startIndex}, {endIndex}) across {innerSplitCount} inner sentence delimiter(s).',
        {
          kind: range.kind,
          startIndex: range.startIndex,
          endIndex: range.endIndex,
          innerSplitCount: innerSplits.length,
        },
      );

      remainingSplits = remainingSplits.filter(
        (split) => split <= range.startIndex || split >= range.endIndex,
      );
      yield* splitRangeAt(range.startIndex, range.endIndex, innerSplits);
    }
  }

  yield* splitRangeAt(0, paragraphText.length, remainingSplits);
}

/**
 * Partitions `[startIndex, endIndex)` at the sorted interior `splits` offsets,
 * yielding contiguous `[start, end)` sub-ranges between adjacent boundaries.
 */
function* splitRangeAt(
  startIndex: number,
  endIndex: number,
  splits: readonly number[],
): Generator<TextRange, void, undefined> {
  const boundaries = iterables.chain([startIndex], splits, [endIndex]);
  for (const [spanStart, spanEnd] of iterables.pairs(boundaries)) {
    yield { startIndex: spanStart, endIndex: spanEnd };
  }
}
