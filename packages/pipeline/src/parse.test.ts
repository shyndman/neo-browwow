import { describe, expect, test } from 'bun:test';

import type { Blockquote, Emphasis, Link, Paragraph, Strong, Text } from 'mdast';
import { VFile } from 'vfile';

import { splitTextNode } from './foundation/mdast';
import { type Parenthetical, type Sentence, TextMetadata } from './mdast';
import { parseFile } from './parse';

test('splits text leaves in place without splitting inline ancestors and attaches sentence spans', async () => {
  const tree = await parseFile(
    new VFile(
      '> Intro [Before **`code`First. Second. Third![image](/image.png)** after](https://example.com "Link title") tail\n>\n> Unchanged',
    ),
  );

  const blockquote = tree.children[0] as Blockquote;
  const paragraph = blockquote.children[0] as Paragraph;
  const untouched = blockquote.children[1] as Paragraph;

  const prefix = paragraph.children[0] as Text;
  const link = paragraph.children[1] as Link;
  const suffix = paragraph.children[2] as Text;

  const before = link.children[0] as Text;
  const strong = link.children[1] as Strong;
  const after = link.children[2] as Text;
  const untouchedText = untouched.children[0] as Text;

  // Formatting ancestors (link, strong) remain intact; only the inner text leaf was split.
  expect(paragraph.children).toEqual([prefix, link, suffix]);
  expect(link.children).toEqual([before, strong, after]);
  expect(strong.children).toHaveLength(5);

  const firstLeaf = strong.children[1] as Text;
  const secondLeaf = strong.children[2] as Text;
  const thirdLeaf = strong.children[3] as Text;

  expect(firstLeaf.value).toBe('First.');
  expect(secondLeaf.value).toBe(' Second.');
  expect(thirdLeaf.value).toBe(' Third');

  // Interior leaves `before` and `after` have no boundary metadata.
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

test('leaves paragraphs with no text nodes unchanged', async () => {
  const tree = await parseFile(new VFile('![diagram](/diagram.png)`x = 1`'));
  const paragraph = tree.children[0] as Paragraph;

  expect(paragraph.children.map((child) => child.type)).toEqual(['image', 'inlineCode']);
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
  test('tags single-leaf round and square parentheticals with start === end', async () => {
    const tree = await parseFile(new VFile('We use Adam (Kingma, 2015) and SGD [1, 2] here.'));
    const paragraph = tree.children[0] as Paragraph;

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

  test('handles nested, empty, and formatting-straddling parentheticals without splitting formatting', async () => {
    const tree = await parseFile(new VFile('*Adam (trained on [ImageNet]* for 90 epochs) and ()'));
    const paragraph = tree.children[0] as Paragraph;
    const emphasis = paragraph.children[0] as Emphasis;

    // Emphasis stays intact as a single node; only its text leaf was split.
    expect(emphasis.type).toBe('emphasis');
    expect(emphasis.children.map((c) => (c as Text).value)).toEqual(['Adam ', '(trained on ', '[ImageNet]']);

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

  test('preserves closed inner parentheticals and sentence splits when outer brackets are crossed or unclosed', async () => {
    const tree = await parseFile(
      new VFile(
        'See 1) intro (crossed [see Smith, 2020. Also Jones, 2021]broken] and (unclosed [cf. Lee, 2022. And Kim, 2023] end.',
      ),
    );
    const paragraph = tree.children[0] as Paragraph;
    const leaves = paragraph.children as Text[];

    expect(leaves.map((l) => l.value)).toEqual([
      'See 1) intro (crossed ',
      '[see Smith, 2020.',
      ' Also Jones, 2021]',
      'broken] and (unclosed ',
      '[cf. Lee, 2022.',
      ' And Kim, 2023]',
      ' end.',
    ]);

    // Host sentence remains a single sentence across the promoted inner parentheticals.
    const hostSentence = leaves[0]?.data?.starts[0] as Sentence;
    expect(hostSentence.text).toBe(
      'See 1) intro (crossed [see Smith, 2020. Also Jones, 2021]broken] and (unclosed [cf. Lee, 2022. And Kim, 2023] end.',
    );
    expect(leaves[6]?.data?.ends).toEqual([hostSentence]);

    // Both closed inner square parentheticals are preserved along with their internal sentence splits.
    const firstParen = leaves[1]?.data?.starts.find((s) => s.type === 'parenthetical') as Parenthetical;
    expect(firstParen.text).toBe('[see Smith, 2020. Also Jones, 2021]');

    const secondParen = leaves[4]?.data?.starts.find((s) => s.type === 'parenthetical') as Parenthetical;
    expect(secondParen.text).toBe('[cf. Lee, 2022. And Kim, 2023]');
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

    // Parenthetical endpoints updated automatically via onSplit when leaves[1..2] split.
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
