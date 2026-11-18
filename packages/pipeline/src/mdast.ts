import type { Parent, Root, RootData, Text, TextData } from 'mdast';

import type { SplitAwareNodeData } from './foundation/mdast';

/** Editorial form of a document governing how its sections and inline elements are spoken aloud. */
export type DocumentType = 'research_paper' | 'blog_post' | 'encyclopedia_entry' | 'news_article' | 'other';

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
 * Split-aware endpoint metadata attached to `node.data` on the `start` and `end`
 * `Text` leaves of each {@link TextSpan} (`Sentence` or `Parenthetical`).
 *
 * Rather than inserting custom wrapper nodes around spans — which would split
 * straddling inline formatting such as `emphasis`, `strong`, or `link` — the
 * pipeline splits only `Text` leaves at span boundaries and records span
 * membership here via {@link TextMetadata.attach}. Interior `Text` leaves and
 * non-text inline nodes carry no `TextMetadata`.
 *
 * When a tagged `Text` leaf is later split into `[left, right]` (for example,
 * when sentence splitting splits a leaf already tagged by parenthetical
 * extraction), {@link onSplit} migrates `starts` (and updates `span.start`) to
 * `left`, and migrates `ends` (and updates `span.end`) to `right`, while leaving
 * `span.commonAncestor` unchanged.
 *
 * A leaf's `starts` or `ends` array holds multiple spans whenever a
 * `Parenthetical` and one or more `Sentence` spans share that boundary leaf —
 * for example, when internal sentence breaks split a `Parenthetical` into inner
 * `Sentence` spans, or when an outer `Sentence` begins directly at an opening
 * bracket or ends directly at a closing bracket.
 *
 * @example
 * Given `"We use Adam (see Kingma, 2015. Compare Loshchilov, 2019) for all runs."`,
 * the paragraph's `Text` leaves are split into four nodes whose `data` holds:
 * ```text
 * "We use Adam "              -> starts: [hostSentence]
 * "(see Kingma, 2015."         -> starts: [parenthetical, innerSentence1], ends: [innerSentence1]
 * " Compare Loshchilov, 2019)" -> starts: [innerSentence2], ends: [parenthetical, innerSentence2]
 * " for all runs."             -> ends:   [hostSentence]
 * ```
 */
export class TextMetadata implements TextData {
  /**
   * `TextSpan`s (`Sentence` or `Parenthetical`) whose first `Text` leaf (`span.start`)
   * is this node. Holds multiple spans when a `Parenthetical` and an inner or
   * outer `Sentence` start on the same leaf.
   */
  readonly starts: TextSpan[];

  /**
   * `TextSpan`s (`Sentence` or `Parenthetical`) whose last `Text` leaf (`span.end`)
   * is this node. Holds multiple spans when a `Parenthetical` and an inner or
   * outer `Sentence` end on the same leaf.
   */
  readonly ends: TextSpan[];

  constructor(starts: TextSpan[] = [], ends: TextSpan[] = []) {
    this.starts = starts;
    this.ends = ends;
  }

  static ensure(node: Text): TextMetadata {
    if (node.data instanceof TextMetadata) {
      return node.data;
    }

    return (node.data = new TextMetadata());
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

/**
 * Document-level metadata attached to `root.data` once the document's
 * {@link DocumentType} has been classified.
 */
export class RootMetadata implements RootData {
  readonly documentType: DocumentType;

  constructor(documentType: DocumentType) {
    this.documentType = documentType;
  }

  static attach(root: Root, documentType: DocumentType): RootMetadata {
    const metadata = new RootMetadata(documentType);

    root.data = metadata;
    return metadata;
  }

  toJSON(): { documentType: DocumentType } {
    return { documentType: this.documentType };
  }
}

declare module 'mdast' {
  interface RootData {
    readonly documentType: DocumentType;
  }

  interface TextData extends SplitAwareNodeData<Text> {
    readonly starts: TextSpan[];
    readonly ends: TextSpan[];
  }
}
