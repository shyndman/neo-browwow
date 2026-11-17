import { describe, expect, test } from 'bun:test';

import type { Emphasis, Image, InlineCode, Link, Paragraph, Root, Strong, Text } from 'mdast';
import { VFile } from 'vfile';

import { splitTextNode } from './foundation/mdast';
import { type Parenthetical, type Sentence, TextMetadata } from './mdast';
import { findParentheticalRanges, parseFile, processParagraphs } from './parse';

test('cleaves text leaves in place without cleaving inline ancestors and attaches sentence spans', () => {
  const prefix: Text = { type: 'text', value: 'Intro ' };
  const before: Text = { type: 'text', value: 'Before ' };
  const after: Text = { type: 'text', value: ' after' };
  const suffix: Text = { type: 'text', value: ' tail' };
  const code: InlineCode = { type: 'inlineCode', value: 'code' };
  const image: Image = { type: 'image', url: '/image.png', alt: 'image' };
  const strong: Strong = {
    type: 'strong',
    children: [code, { type: 'text', value: 'First. Second. Third' }, image],
  };
  const link: Link = {
    type: 'link',
    url: 'https://example.com',
    title: 'Link title',
    data: { hProperties: { className: ['link'] } },
    children: [before, strong, after],
  };
  const paragraph: Paragraph = {
    type: 'paragraph',
    children: [prefix, link, suffix],
  };
  const untouchedText: Text = { type: 'text', value: 'Unchanged' };
  const untouched: Paragraph = {
    type: 'paragraph',
    children: [untouchedText],
  };
  const tree: Root = {
    type: 'root',
    children: [{ type: 'blockquote', children: [paragraph, untouched] }],
  };

  processParagraphs(tree);

  // Formatting ancestors (link, strong) remain intact; only the inner text leaf was cleaved.
  expect(paragraph.children).toEqual([prefix, link, suffix]);
  expect(link.children).toEqual([before, strong, after]);
  expect(strong.children).toHaveLength(5);

  const firstLeaf = strong.children[1] as Text;
  const secondLeaf = strong.children[2] as Text;
  const thirdLeaf = strong.children[3] as Text;

  expect(firstLeaf.value).toBe('First.');
  expect(secondLeaf.value).toBe(' Second.');
  expect(thirdLeaf.value).toBe(' Third');

  // Interior leaf `before` has no boundary metadata.
  expect(before.data).toBeUndefined();
  expect(after.data).toBeUndefined();

  const firstSentence = prefix.data?.starts[0] as Sentence;
  expect(firstSentence).toEqual({
    type: 'sentence',
    commonAncestor: paragraph,
    start: prefix,
    end: firstLeaf,
    text: 'Intro Before First.',
  });
  expect(firstLeaf.data?.ends).toEqual([firstSentence]);

  const secondSentence = secondLeaf.data?.starts[0] as Sentence;
  expect(secondSentence).toEqual({
    type: 'sentence',
    commonAncestor: strong,
    start: secondLeaf,
    end: secondLeaf,
    text: ' Second.',
  });
  expect(secondLeaf.data?.ends).toEqual([secondSentence]);

  const thirdSentence = thirdLeaf.data?.starts[0] as Sentence;
  expect(thirdSentence).toEqual({
    type: 'sentence',
    commonAncestor: paragraph,
    start: thirdLeaf,
    end: suffix,
    text: ' Third after tail',
  });
  expect(suffix.data?.ends).toEqual([thirdSentence]);

  const untouchedSentence = untouchedText.data?.starts[0] as Sentence;
  expect(untouchedSentence).toEqual({
    type: 'sentence',
    commonAncestor: untouched,
    start: untouchedText,
    end: untouchedText,
    text: 'Unchanged',
  });
});

test('leaves paragraphs with no text nodes unchanged', () => {
  const image: Image = { type: 'image', url: '/diagram.png', alt: 'diagram' };
  const code: InlineCode = { type: 'inlineCode', value: 'x = 1' };
  const paragraph: Paragraph = {
    type: 'paragraph',
    children: [image, code],
  };
  const tree: Root = {
    type: 'root',
    children: [paragraph],
  };

  processParagraphs(tree);

  expect(paragraph.children).toEqual([image, code]);
});

describe('TextMetadata.onSplit', () => {
  test('migrates starts to the left leaf, ends to the right leaf, and leaves interior splits without metadata', () => {
    const paragraph: Paragraph = { type: 'paragraph', children: [] };
    const initial: Text = { type: 'text', value: '(first. Second. Third)' };
    paragraph.children.push(initial);

    const parenthetical: Parenthetical = {
      type: 'parenthetical',
      kind: 'round',
      commonAncestor: paragraph,
      start: initial,
      end: initial,
      text: initial.value,
    };
    TextMetadata.attach(parenthetical);

    const [leftFirst, thirdLeaf] = splitTextNode(initial, 15);
    expect(parenthetical.start).toBe(leftFirst);
    expect(parenthetical.end).toBe(thirdLeaf);
    expect(leftFirst.data?.starts).toEqual([parenthetical]);
    expect(leftFirst.data?.ends).toEqual([]);
    expect(thirdLeaf.data?.starts).toEqual([]);
    expect(thirdLeaf.data?.ends).toEqual([parenthetical]);

    const [firstLeaf, secondLeaf] = splitTextNode(leftFirst, 7);
    expect(parenthetical.start).toBe(firstLeaf);
    expect(parenthetical.end).toBe(thirdLeaf);
    expect(firstLeaf.data?.starts).toEqual([parenthetical]);
    expect(secondLeaf.data).toBeUndefined();
    expect(JSON.parse(JSON.stringify(firstLeaf.data))).toEqual({
      starts: ['parenthetical:(first. Second. Third)'],
      ends: [],
    });
  });
});

describe('findParentheticalRanges and tagParentheticals', () => {
  test('tags single-leaf round and square parentheticals with start === end', () => {
    const text: Text = { type: 'text', value: 'We use Adam (Kingma, 2015) and SGD [1, 2] here.' };
    const paragraph: Paragraph = { type: 'paragraph', children: [text] };
    const tree: Root = { type: 'root', children: [paragraph] };

    processParagraphs(tree);

    expect(paragraph.children.map((child) => (child as Text).value)).toEqual([
      'We use Adam ',
      '(Kingma, 2015)',
      ' and SGD ',
      '[1, 2]',
      ' here.',
    ]);

    const roundLeaf = paragraph.children[1] as Text;
    const squareLeaf = paragraph.children[3] as Text;

    const roundSpan = roundLeaf.data?.starts[0] as Parenthetical;
    expect(roundSpan).toEqual({
      type: 'parenthetical',
      kind: 'round',
      commonAncestor: paragraph,
      start: roundLeaf,
      end: roundLeaf,
      text: '(Kingma, 2015)',
    });
    expect(roundLeaf.data?.ends).toEqual([roundSpan]);

    const squareSpan = squareLeaf.data?.starts[0] as Parenthetical;
    expect(squareSpan).toEqual({
      type: 'parenthetical',
      kind: 'square',
      commonAncestor: paragraph,
      start: squareLeaf,
      end: squareLeaf,
      text: '[1, 2]',
    });
    expect(squareLeaf.data?.ends).toEqual([squareSpan]);
  });

  test('handles nested, empty, and formatting-straddling parentheticals without cleaving formatting', () => {
    const emLead: Text = { type: 'text', value: 'Adam (trained on [ImageNet] ' };
    const emphasis: Emphasis = { type: 'emphasis', children: [emLead] };
    const tail: Text = { type: 'text', value: 'for 90 epochs) and ()' };
    const paragraph: Paragraph = { type: 'paragraph', children: [emphasis, tail] };
    const tree: Root = { type: 'root', children: [paragraph] };

    processParagraphs(tree);

    // Emphasis stays intact as a single node; only its text leaf was cleaved.
    expect(paragraph.children[0]).toBe(emphasis);
    expect(emphasis.children.map((c) => (c as Text).value)).toEqual([
      'Adam ',
      '(trained on ',
      '[ImageNet]',
      ' ',
    ]);

    const outerStart = emphasis.children[1] as Text;
    const innerLeaf = emphasis.children[2] as Text;
    const outerEnd = paragraph.children[1] as Text;
    const emptyLeaf = paragraph.children[3] as Text;

    const outerSpan = outerStart.data?.starts[0] as Parenthetical;
    expect(outerSpan).toEqual({
      type: 'parenthetical',
      kind: 'round',
      commonAncestor: paragraph,
      start: outerStart,
      end: outerEnd,
      text: '(trained on [ImageNet] for 90 epochs)',
    });

    const innerSpan = innerLeaf.data?.starts[0] as Parenthetical;
    expect(innerSpan).toEqual({
      type: 'parenthetical',
      kind: 'square',
      commonAncestor: emphasis,
      start: innerLeaf,
      end: innerLeaf,
      text: '[ImageNet]',
    });

    const emptySpan = emptyLeaf.data?.starts[0] as Parenthetical;
    expect(emptySpan).toEqual({
      type: 'parenthetical',
      kind: 'round',
      commonAncestor: paragraph,
      start: emptyLeaf,
      end: emptyLeaf,
      text: '()',
    });
  });

  test.each([
    { name: 'unmatched closing round', input: 'Text with stray ) here.' },
    { name: 'unmatched closing square', input: 'Text with stray ] here.' },
    { name: 'crossed round-square', input: 'Crossed ([brackets)] here.' },
    { name: 'crossed square-round', input: 'Crossed [(brackets]) here.' },
    { name: 'unclosed opening round', input: 'Unclosed (bracket here.' },
    { name: 'unclosed opening square', input: 'Unclosed [bracket here.' },
  ])('throws on $name brackets', ({ input }) => {
    expect(() => Array.from(findParentheticalRanges(input))).toThrow();
  });
});

describe('parseFile parenthetical and sentence integration', () => {
  test('keeps host sentence intact across an inline multi-sentence parenthetical and attaches inner sentences', async () => {
    const tree = await parseFile(
      new VFile('We use Adam (see Kingma, 2015. Compare Loshchilov, 2019) for all runs.'),
    );
    const paragraph = tree.children[0] as Paragraph;
    const leaves = paragraph.children as Text[];

    expect(leaves.map((l) => l.value)).toEqual([
      'We use Adam ',
      '(see Kingma, 2015.',
      ' Compare Loshchilov, 2019)',
      ' for all runs.',
    ]);

    // Host sentence spans the full paragraph from leaves[0] to leaves[3].
    const hostSentence = leaves[0]?.data?.starts[0] as Sentence;
    expect(hostSentence).toEqual({
      type: 'sentence',
      commonAncestor: paragraph,
      start: leaves[0]!,
      end: leaves[3]!,
      text: 'We use Adam (see Kingma, 2015. Compare Loshchilov, 2019) for all runs.',
    });
    expect(leaves[3]?.data?.ends).toEqual([hostSentence]);

    // Parenthetical endpoints updated automatically via onSplit when leaves[1..2] cleaved.
    const parenthetical = leaves[1]?.data?.starts.find((s) => s.type === 'parenthetical') as Parenthetical;
    expect(parenthetical).toEqual({
      type: 'parenthetical',
      kind: 'round',
      commonAncestor: paragraph,
      start: leaves[1]!,
      end: leaves[2]!,
      text: '(see Kingma, 2015. Compare Loshchilov, 2019)',
    });
    expect(leaves[2]?.data?.ends).toContain(parenthetical);

    // Two inner sentences inside the multi-sentence parenthetical.
    const innerSentence1 = leaves[1]?.data?.starts.find((s) => s.type === 'sentence') as Sentence;
    const innerSentence2 = leaves[2]?.data?.starts.find((s) => s.type === 'sentence') as Sentence;
    expect(innerSentence1?.text).toBe('(see Kingma, 2015.');
    expect(innerSentence2?.text).toBe(' Compare Loshchilov, 2019)');
  });

  test('attaches inner sentences when a parenthetical contains internal sentence splits', async () => {
    const tree = await parseFile(new VFile('We use Adam. (See Kingma, 2015. Compare Loshchilov, 2019.)'));
    const paragraph = tree.children[0] as Paragraph;
    const leaves = paragraph.children as Text[];

    expect(leaves.map((l) => l.value)).toEqual([
      'We use Adam.',
      ' ',
      '(See Kingma, 2015.',
      ' Compare Loshchilov, 2019.)',
    ]);

    const firstSentence = leaves[0]?.data?.starts[0] as Sentence;
    expect(firstSentence.text).toBe('We use Adam.');

    const outerSecondSentence = leaves[1]?.data?.starts[0] as Sentence;
    expect(outerSecondSentence.text).toBe(' (See Kingma, 2015. Compare Loshchilov, 2019.)');

    // The multi-sentence parenthetical also has its parenthetical span and two inner sentences.
    expect(leaves[2]?.data?.starts).toHaveLength(2);
    expect(leaves[3]?.data?.starts).toHaveLength(1);
  });
});
