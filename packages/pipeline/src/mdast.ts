import type { Parent, Text, TextData } from 'mdast';

import type { SplitAwareNodeData } from './foundation/mdast';

/** The bracket pair enclosing a parenthetical span: `(...)` or `[...]`. */
export type ParentheticalKind = 'round' | 'square';

/**
 * A sentence span within a paragraph, bounded by its inclusive `start` and `end`
 * text leaves under `commonAncestor`.
 */
export interface Sentence {
  type: 'sentence';
  /** Lowest common AST parent containing both `start` and `end`. */
  commonAncestor: Parent;
  /** First text leaf of the sentence. */
  start: Text;
  /** Last text leaf of the sentence (`start === end` for single-leaf sentences). */
  end: Text;
  /** Plain-text content of the sentence across `start` through `end`. */
  text: string;
}

/**
 * A parenthesized `(...)` or bracketed `[...]` span within a paragraph, bounded
 * by its inclusive `start` and `end` text leaves under `commonAncestor`.
 */
export interface Parenthetical {
  type: 'parenthetical';
  kind: ParentheticalKind;
  /** Lowest common AST parent containing both `start` and `end`. */
  commonAncestor: Parent;
  /** First text leaf of the parenthetical, beginning with the opening bracket. */
  start: Text;
  /** Last text leaf of the parenthetical, ending with the closing bracket. */
  end: Text;
  /** Plain-text content of the parenthetical across `start` through `end`. */
  text: string;
}

/** An inline span tracked via endpoint metadata on its boundary text leaves. */
export type TextSpan = Sentence | Parenthetical;

/**
 * Endpoint metadata attached only to the `start` and `end` text leaves of each
 * `TextSpan`. When a boundary leaf is split, `starts` migrate to the left leaf
 * and `ends` migrate to the right leaf.
 */
export class TextMetadata implements TextData {
  readonly starts: TextSpan[];
  readonly ends: TextSpan[];

  constructor(starts: TextSpan[] = [], ends: TextSpan[] = []) {
    this.starts = starts;
    this.ends = ends;
  }

  static ensure(node: Text): TextMetadata {
    if (node.data instanceof TextMetadata) {
      return node.data;
    }

    const metadata = new TextMetadata();
    node.data = metadata;
    return metadata;
  }

  static attach(span: TextSpan): void {
    TextMetadata.ensure(span.start).starts.push(span);
    TextMetadata.ensure(span.end).ends.push(span);
  }

  onSplit(left: Text, right: Text): void {
    if (this.starts.length > 0) {
      for (const span of this.starts) {
        span.start = left;
      }

      left.data = new TextMetadata([...this.starts], []);
    }

    if (this.ends.length > 0) {
      for (const span of this.ends) {
        span.end = right;
      }

      right.data = new TextMetadata([], [...this.ends]);
    }
  }

  toJSON(): { starts: string[]; ends: string[] } {
    return {
      starts: this.starts.map((span) => `${span.type}:${span.text}`),
      ends: this.ends.map((span) => `${span.type}:${span.text}`),
    };
  }
}

declare module 'mdast' {
  interface TextData extends SplitAwareNodeData<Text> {
    readonly starts: TextSpan[];
    readonly ends: TextSpan[];
  }
}
