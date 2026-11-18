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
import * as strings from './foundation/strings';
import { type ParentheticalKind, TextMetadata, type TextSpan } from './mdast';
import { findSentenceDelimiters } from './sentence-splitter/index';

const logger = getLogger(['browwow', 'pipeline', 'parse']);

export async function parseFile(markdownFile: VFile): Promise<Root> {
  const source = prepareSource(markdownFile.value);

  const sourceLabel = markdownFile.path || '<inline>';

  logger.debug('Parsing Markdown source {source} ({charCount} chars).', {
    source: sourceLabel,
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

  logger.info('Parsed Markdown tree for {source} ({childCount} root children).', {
    source: sourceLabel,
    childCount: tree.children.length,
  });

  return tree;
}

function prepareSource(value: Uint8Array | string): string {
  return (
    (value instanceof Uint8Array ? new TextDecoder('utf-8').decode(value) : value)
      .replaceAll('\u00A0', ' ')
      // Get rid of fancy quotes -- they confuse TTS engines, and are of limited usefulness to
      .replaceAll(/[“”]/gu, '"')
      .replaceAll(/[‘’]/gu, "'")
  );
}

export interface TextScope extends TextRange {
  children: readonly ParentheticalRange[];
}

export interface ParentheticalRange extends TextScope {
  kind: ParentheticalKind;
  children: ParentheticalRange[];
}

interface ParagraphContext {
  paragraph: Paragraph;
  paragraphText: string;
  leafTextRanges: RangeMap<Text>;
  ancestorsByText: Map<Text, Parent[]>;
}

/**
 * Processes every paragraph in the tree in a single per-paragraph pass,
 * cleaving text leaves and attaching `Parenthetical` and `Sentence` spans.
 */
export function processParagraphs(tree: Node): void {
  for (const node of selectAll('paragraph', tree)) {
    // SAFETY: The selectAll() above ensures that the node is indeed a Paragraph.
    const ctx = createParagraphContext(node as Paragraph);
    if (ctx.paragraphText.length === 0) {
      console.debug('Skipping paragraph with no text nodes');
      continue;
    }

    const parentheticalRanges = attachParagraphParentheticals(ctx);
    attachParagraphSentences(ctx, parentheticalRanges);
  }
}

function attachParagraphParentheticals(ctx: ParagraphContext): ParentheticalRange[] {
  const topLevelRanges: ParentheticalRange[] = [];

  for (const { range, isTopLevel } of findParentheticalRanges(ctx.paragraphText)) {
    if (isTopLevel) {
      topLevelRanges.push(range);
    }

    splitAndAttachSpan(ctx, range, (commonAncestor, start, end, text) => ({
      type: 'parenthetical',
      kind: range.kind,
      commonAncestor,
      start,
      end,
      text,
    }));
  }

  return topLevelRanges;
}

function attachParagraphSentences(
  ctx: ParagraphContext,
  topLevelParentheticals: readonly ParentheticalRange[],
): void {
  for (const range of findSentenceRanges(ctx.paragraphText, topLevelParentheticals)) {
    console.debug(`Attaching sentence from index ${range.startIndex} to ${range.endIndex}`);

    splitAndAttachSpan(ctx, range, (commonAncestor, start, end, text) => ({
      type: 'sentence',
      commonAncestor,
      start,
      end,
      text,
    }));
  }
}

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

function splitParagraphAt(ctx: ParagraphContext, splitIndex: number): [Text | null, Text] {
  const nodeAtIndex = ctx.leafTextRanges.get(splitIndex);
  console.debug(`Splitting text at index ${splitIndex}, text:\n`, nodeAtIndex.value);

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
 * Yields balanced `(...)` and `[...]` ranges in plain paragraph text as each
 * closing bracket is encountered, throwing on unmatched, crossed, or unclosed brackets.
 */
export function* findParentheticalRanges(
  text: string,
): Generator<{ range: ParentheticalRange; isTopLevel: boolean }, void, undefined> {
  const openStack: ParentheticalRange[] = [];

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '(' || char === '[') {
      openStack.push({
        kind: char === '(' ? 'round' : 'square',
        startIndex: i,
        endIndex: -1,
        children: [],
      });
      continue;
    }

    if (char === ')' || char === ']') {
      yield closeParentheticalRange(openStack, char, i, text);
    }
  }

  const unclosed = openStack.at(-1);
  if (unclosed !== undefined) {
    throw new Error(`Unclosed ${unclosed.kind} bracket at index ${unclosed.startIndex}`, {
      cause: {
        kind: unclosed.kind,
        startIndex: unclosed.startIndex,
        text,
      },
    });
  }
}

type HierarchicalParentheticalRange = {
  range: ParentheticalRange;
  isTopLevel: boolean;
};

function closeParentheticalRange(
  openStack: ParentheticalRange[],
  char: ')' | ']',
  index: number,
  text: string,
): HierarchicalParentheticalRange {
  const expectedKind: ParentheticalKind = char === ')' ? 'round' : 'square';
  const openRange = openStack.pop();

  if (openRange === undefined) {
    throw new Error(`Unmatched closing bracket "${char}" at index ${index}`, {
      cause: { char, index, text },
    });
  }

  if (openRange.kind !== expectedKind) {
    throw new Error(
      `Crossed closing bracket "${char}" at index ${index} for ${openRange.kind} bracket opened at index ${openRange.startIndex}`,
      {
        cause: {
          char,
          index,
          openKind: openRange.kind,
          openIndex: openRange.startIndex,
          text,
        },
      },
    );
  }

  openRange.endIndex = index + 1;
  const parentRange = openStack.at(-1);
  if (parentRange !== undefined) {
    parentRange.children.push(openRange);
  }

  return { range: openRange, isTopLevel: parentRange === undefined };
}

function* findSentenceRanges(
  paragraphText: string,
  topLevelParentheticals: readonly ParentheticalRange[],
): Generator<TextRange, void, undefined> {
  const sentenceSplitIndices = Array.from(findSentenceDelimiters(paragraphText));
  console.debug(
    `Evaluating ${paragraphText}\nFound ${sentenceSplitIndices.length} sentence split ` +
      strings.plural(sentenceSplitIndices, 'index', 'indices'),
  );

  const rootScope: TextScope = {
    startIndex: 0,
    endIndex: paragraphText.length,
    children: topLevelParentheticals,
  };

  yield* findScopeSentenceRanges(rootScope, true, sentenceSplitIndices);
}

function* findScopeSentenceRanges(
  scope: TextScope,
  isRoot: boolean,
  sentenceSplitIndices: readonly number[],
): Generator<TextRange, void, undefined> {
  const directSplits = sentenceSplitIndices.filter(
    (splitIndex) =>
      splitIndex > scope.startIndex &&
      splitIndex < scope.endIndex &&
      !scope.children.some((child) => splitIndex > child.startIndex && splitIndex < child.endIndex),
  );

  if (isRoot || directSplits.length > 0) {
    const boundaryIndices = iterables.chain([scope.startIndex], directSplits, [scope.endIndex]);
    for (const [spanStart, spanEnd] of iterables.pairs(boundaryIndices)) {
      yield { startIndex: spanStart, endIndex: spanEnd };
    }
  }

  for (const childRange of scope.children) {
    yield* findScopeSentenceRanges(childRange, false, sentenceSplitIndices);
  }
}

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
