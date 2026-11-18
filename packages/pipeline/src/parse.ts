import { getLogger } from '@logtape/logtape';
import type { Node, Paragraph, Parent, Root, Text } from 'mdast';
import { remark } from 'remark';
import remarkDirective from 'remark-directive';
import remarkExtendedTable from 'remark-extended-table';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { selectAll } from 'unist-util-select';
import { visitParents } from 'unist-util-visit-parents';
import type { VFile } from 'vfile';

import * as arrays from './foundation/arrays';
import * as iterables from './foundation/iterables';
import { findCommonAncestor, isTextNode, splitTextNode } from './foundation/mdast';
import { RangeMap } from './foundation/range-map';
import type { TextRange } from './foundation/strings';
import { TextMetadata, type TextSpan } from './mdast';
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
  const transformedTree = await parser.run(tree);

  // Identify parts of text important to its pronunciation
  processParagraphs(transformedTree);

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
 * Bridges a paragraph's nested inline AST (`emphasis`, `strong`, `link`, etc.)
 * and flat character-offset scanners. Maps offsets in `paragraphText` back to
 * their owning `Text` leaves and AST ancestor chains as leaves are cleaved.
 */
interface ParagraphContext {
  paragraph: Paragraph;
  paragraphText: string;
  leafTextRanges: RangeMap<Text>;
  ancestorsByText: Map<Text, Parent[]>;
}

/**
 * Annotates every paragraph in `tree` with `Parenthetical` and `Sentence`
 * endpoint metadata by cleaving `Text` leaves in place at span boundaries.
 * Parentheticals are extracted first so their bounds prevent internal periods
 * from breaking the enclosing host sentence.
 */
export function processParagraphs(tree: Node): void {
  for (const node of selectAll('paragraph', tree)) {
    // SAFETY: The selectAll() above ensures that the node is indeed a Paragraph.
    const ctx = createParagraphContext(node as Paragraph);
    if (ctx.paragraphText.length > 0) {
      const parentheticalRanges = attachParagraphParentheticals(ctx);
      attachParagraphSentences(ctx, parentheticalRanges);
    }
  }
}

/**
 * Flattens all `Text` leaves under `paragraph` into a single contiguous string
 * (`paragraphText`) while indexing each leaf's character range in `leafTextRanges`
 * and recording its root-to-parent ancestor chain in `ancestorsByText`.
 *
 * This lets parenthetical and sentence finders work on plain string indices
 * while span attachment maps those indices back to the underlying AST nodes.
 */
function createParagraphContext(paragraph: Paragraph): ParagraphContext {
  let paragraphText = '';
  const leafTextRanges = new RangeMap<Text>(splitTextNode);
  const ancestorsByText = new Map<Text, Parent[]>();

  visitParents(paragraph, isTextNode, (node, ancestors) => {
    leafTextRanges.append(node);
    paragraphText += node.value;
    ancestorsByText.set(node, ancestors);
  });

  return { paragraph, paragraphText, leafTextRanges, ancestorsByText };
}

/**
 * Finds balanced `(...)` and `[...]` ranges in the paragraph's plain text,
 * cleaves the AST `Text` leaves at each bracket's start and end offsets, and
 * attaches a `Parenthetical` span to those boundary leaves. Returns the ranges
 * in innermost-first order so sentence splitting can isolate inner delimiters.
 */
function attachParagraphParentheticals(ctx: ParagraphContext): ParentheticalRange[] {
  const ranges = Array.from(findParentheticalRanges(ctx.paragraphText));
  for (const range of ranges) {
    splitAndAttachSpan(ctx, range, (commonAncestor, start, end, text) => ({
      type: 'parenthetical',
      kind: range.kind,
      commonAncestor,
      start,
      end,
      text,
    }));
  }

  return ranges;
}

/**
 * Cleaves the paragraph's AST `Text` leaves at every sentence boundary — both
 * outer host sentences and inner sentences inside multi-sentence parentheticals —
 * and attaches a `Sentence` span to each sentence's start and end leaves.
 */
function attachParagraphSentences(
  ctx: ParagraphContext,
  parentheticalRanges: readonly ParentheticalRange[],
): void {
  for (const range of findSentenceRanges(ctx.paragraphText, parentheticalRanges)) {
    splitAndAttachSpan(ctx, range, (commonAncestor, start, end, text) => ({
      type: 'sentence',
      commonAncestor,
      start,
      end,
      text,
    }));
  }
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

  for (const range of parentheticalRanges) {
    const innerSplits = remainingSplits.filter((split) => split > range.startIndex && split < range.endIndex);

    if (innerSplits.length > 0) {
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

/**
 * Projects a plain-text character `range` back onto the paragraph's AST `Text`
 * leaves and attaches the `TextSpan` produced by `createSpan` to its boundary
 * leaves (`start` and `end`).
 *
 * Cleaves the leaf at `range.endIndex` first and `range.startIndex` second so
 * the span's start and end land on exact `Text` node boundaries without
 * cleaving enclosing formatting nodes (`emphasis`, `strong`, `link`).
 */
function splitAndAttachSpan(
  ctx: ParagraphContext,
  range: TextRange,
  createSpan: (commonAncestor: Parent, start: Text, end: Text, text: string) => TextSpan,
): void {
  if (range.endIndex < ctx.paragraphText.length) {
    splitParagraphAt(ctx, range.endIndex);
  }

  const [, startText] = splitParagraphAt(ctx, range.startIndex);
  const endText = ctx.leafTextRanges.get(range.endIndex - 1);
  const commonAncestor = resolveCommonAncestor(ctx.ancestorsByText, startText, endText);
  const text = ctx.paragraphText.slice(range.startIndex, range.endIndex);

  TextMetadata.attach(createSpan(commonAncestor, startText, endText, text));
}

/**
 * Ensures a `Text` leaf boundary exists at `splitIndex` in `paragraphText`.
 *
 * If `splitIndex` falls inside a `Text` leaf, cleaves that leaf into `[left, right]`
 * in both `leafTextRanges` and its parent's `children` array (migrating any
 * existing `TextMetadata` endpoints via `onSplit`) and records the same
 * ancestor chain for both new halves. If `splitIndex` already aligns with the
 * start of a leaf, returns `[null, right]` without mutating the tree.
 */
function splitParagraphAt(ctx: ParagraphContext, splitIndex: number): [Text | null, Text] {
  const nodeAtIndex = ctx.leafTextRanges.get(splitIndex);

  const [left, right] = ctx.leafTextRanges.split(splitIndex);
  if (left === null) {
    return [null, right];
  }

  const ancestors = ctx.ancestorsByText.get(nodeAtIndex);
  const parent = ancestors?.at(-1);
  if (ancestors === undefined || parent === undefined) {
    throw new Error("Illegal state encountered. Expected to find leaf text in its parent's children.", {
      cause: { splitIndex, nodeAtIndex },
    });
  }

  arrays.replace(parent.children, nodeAtIndex, left, right);
  ctx.ancestorsByText.set(left, ancestors);
  ctx.ancestorsByText.set(right, ancestors);
  return [left, right];
}

/**
 * Looks up the root-to-parent ancestor chains for a span's `startText` and
 * `endText` leaves and returns their deepest shared `Parent` node in the AST.
 */
function resolveCommonAncestor(ancestorsByText: Map<Text, Parent[]>, startText: Text, endText: Text): Parent {
  const startAncestors = ancestorsByText.get(startText);
  const endAncestors = ancestorsByText.get(endText);

  if (startAncestors === undefined || endAncestors === undefined) {
    throw new Error('Expected to find ancestors for boundary text node', {
      cause: { startText, endText },
    });
  }

  return findCommonAncestor(startAncestors, endAncestors);
}
