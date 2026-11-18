import { getLogger } from '@logtape/logtape';
import type { Root } from 'mdast';
import { type Options as ToStringOptions, toString } from 'mdast-util-to-string';
import { SKIP, visit } from 'unist-util-visit';

import * as strings from '../foundation/strings';

const logger = getLogger(['browwow', 'pipeline', 'classify', 'sample']);

const BEGINNING_WORD_BUDGET = 160;
const MIDDLE_WORD_BUDGET = 120;
const END_WORD_BUDGET = 120;
const MAX_FULL_DOCUMENT_WORDS = BEGINNING_WORD_BUDGET + MIDDLE_WORD_BUDGET + END_WORD_BUDGET;

const CAPTION_DIRECTIVE_NAME = 'caption';
const TO_STRING_OPTIONS: ToStringOptions = {
  includeImageAlt: false,
  includeHtml: false,
};

export type DocumentSampleState =
  | { readonly content: string }
  | { readonly beginning: string; readonly middle: string; readonly end: string };

interface Section {
  readonly heading: string;
  readonly content: string;
}

/**
 * Extracts `{ heading, content }` sections from `tree` and assembles either the
 * full document (`<= 400` content words) or `beginning`, `middle`, and `end`
 * excerpts starting at section indices `0`, `floor(len / 2)`, and `len - 1`.
 * Returns `null` when `tree` contains no extractable text.
 */
export function sampleDocumentForClassification(tree: Root): DocumentSampleState | null {
  const sections = extractSections(tree);

  if (sections.length === 0) {
    return null;
  }

  const totalWords = sections.reduce((sum, section) => sum + strings.splitWords(section.content).length, 0);

  if (totalWords <= MAX_FULL_DOCUMENT_WORDS) {
    logger.debug(
      'Using full document for classification ({totalWords} content words across {sectionCount} sections).',
      { totalWords, sectionCount: sections.length },
    );

    return {
      content: sections.map((section) => formatSection(section.heading, section.content)).join('\n\n'),
    };
  }

  const beginningIndex = 0;
  const middleIndex = Math.floor(sections.length / 2);
  const endIndex = sections.length - 1;
  const selectedIndices = new Set([beginningIndex, middleIndex, endIndex]);

  logger.debug(
    'Sampling document excerpts for classification ({totalWords} content words across {sectionCount} sections).',
    {
      totalWords,
      sectionCount: sections.length,
      beginningIndex,
      middleIndex,
      endIndex,
    },
  );

  return {
    beginning: readExcerpt(sections, beginningIndex, BEGINNING_WORD_BUDGET, selectedIndices),
    middle: readExcerpt(sections, middleIndex, MIDDLE_WORD_BUDGET, selectedIndices),
    end: readExcerpt(sections, endIndex, END_WORD_BUDGET, selectedIndices),
  };
}

function extractSections(tree: Root): Section[] {
  const sections: Section[] = [];
  let heading = '';
  let parts: string[] = [];

  const flush = (): void => {
    if (heading.length > 0 || parts.length > 0) {
      sections.push({ heading, content: parts.join('\n\n') });
      heading = '';
      parts = [];
    }
  };

  const append = (raw: string): void => {
    const text = raw.trim();
    if (text.length > 0) parts.push(text);
  };

  visit(tree, (node) => {
    switch (node.type) {
      case 'heading':
        flush();
        heading = toString(node, TO_STRING_OPTIONS).trim();
        return SKIP;

      case 'paragraph':
      case 'code':
      case 'math':
      case 'tableCell':
        append(toString(node, TO_STRING_OPTIONS));
        return SKIP;

      case 'leafDirective':
        if (node.name === CAPTION_DIRECTIVE_NAME) {
          append(toString(node, TO_STRING_OPTIONS));
        }

        return SKIP;

      case 'containerDirective':
        if (node.name !== CAPTION_DIRECTIVE_NAME) return SKIP;
        break;

      default:
        break;
    }
  });

  flush();
  return sections;
}

function readExcerpt(
  sections: readonly Section[],
  startIndex: number,
  wordBudget: number,
  selectedIndices: ReadonlySet<number>,
): string {
  const parts: string[] = [];
  let wordsTaken = 0;

  for (let index = startIndex; index < sections.length && wordsTaken < wordBudget; index++) {
    if (index > startIndex && selectedIndices.has(index)) break;

    const { heading, content } = sections[index];
    const words = strings.splitWords(content).slice(0, wordBudget - wordsTaken);

    wordsTaken += words.length;
    parts.push(formatSection(heading, words.join(' ')));
  }

  return parts.join('\n\n');
}

function formatSection(heading: string, content: string): string {
  return [heading, content].filter(Boolean).join('\n\n');
}
