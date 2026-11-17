import { describe, expect, test } from 'bun:test';
import { findSentenceDelimiters } from './index';

interface SplitCase {
  readonly name: string;
  readonly text: string;
  readonly offsets: number[];
}

const cases: readonly SplitCase[] = [
  { name: 'empty input', text: '', offsets: [] },
  { name: 'spaces-only input', text: '   ', offsets: [] },
  { name: 'unpunctuated text', text: 'One unfinished thought', offsets: [] },
  { name: 'a single sentence', text: 'Hello world.', offsets: [] },
  {
    name: 'successive periods',
    text: 'First. Second. Third.',
    offsets: [6, 14],
  },
  {
    name: 'questions and exclamations',
    text: 'Ready? Yes! Go.',
    offsets: [6, 11],
  },
  {
    name: 'repeated punctuation',
    text: 'Really?! Yes!! Fine.',
    offsets: [8, 14],
  },
  { name: 'ellipses', text: 'Wait... Next.', offsets: [7] },
  { name: 'two dots', text: 'Wait.. Next.', offsets: [6] },
  {
    name: 'lowercase after ellipses',
    text: 'Wait... perhaps later.',
    offsets: [],
  },
  {
    name: 'lowercase continuations',
    text: 'One. another? maybe! later.',
    offsets: [],
  },
  {
    name: 'numeric sentence starters',
    text: 'Done. 123 remain.',
    offsets: [5],
  },
  {
    name: 'question followed by a number',
    text: 'Ready? 123 remain.',
    offsets: [],
  },
  {
    name: 'exclamation followed by a number',
    text: 'Go! 123 remain.',
    offsets: [],
  },
  {
    name: 'no separating spaces',
    text: 'First.Second!Third?Fourth',
    offsets: [],
  },
  {
    name: 'decimal numbers',
    text: 'Value 3.14 is exact. Next.',
    offsets: [20],
  },
  {
    name: 'honorifics',
    text: 'Dr. Smith met Mrs. Jones. They left.',
    offsets: [25],
  },
  { name: 'initials', text: 'A. B. Smith arrived. Welcome.', offsets: [20] },
  {
    name: 'multi-period prefixes',
    text: 'A Ph.D. Student arrived. Next.',
    offsets: [24],
  },
  {
    name: 'lowercase multi-period prefixes',
    text: 'Use e.g. Examples and i.e. Details.',
    offsets: [],
  },
  {
    name: 'uppercase acronyms',
    text: 'The U.S.A. Team arrived. Next.',
    offsets: [24],
  },
  {
    name: 'lowercase acronym endings',
    text: 'At p.m. Tomorrow begins.',
    offsets: [7],
  },
  {
    name: 'case-sensitive prefix lookup',
    text: 'dr. Smith arrived.',
    offsets: [3],
  },
  {
    name: 'numeric prefix before digits',
    text: 'No. 12 arrived. Next.',
    offsets: [15],
  },
  {
    name: 'numeric prefix overrides ordinary prefix',
    text: 'No. Thanks.',
    offsets: [3],
  },
  {
    name: 'overlapping page prefix before uppercase',
    text: 'See pp. Appendix.',
    offsets: [7],
  },
  {
    name: 'numeric-only prefix before uppercase',
    text: 'Art. Next.',
    offsets: [4],
  },
  { name: 'numeric prefix before lowercase', text: 'No. thanks.', offsets: [] },
  {
    name: 'numeric prefix before quoted digits',
    text: 'No. "12" arrived.',
    offsets: [3],
  },
  {
    name: 'numeric prefix before parenthesized digits',
    text: 'No. (12) arrived.',
    offsets: [3],
  },
  {
    name: 'numeric prefix before non-ASCII digits',
    text: 'No. ١٢ arrived.',
    offsets: [],
  },
  {
    name: 'double-quoted sentence ending',
    text: 'He said "Go." Next.',
    offsets: [13],
  },
  {
    name: 'single-quoted sentence ending',
    text: "He said 'Go!' Next.",
    offsets: [13],
  },
  {
    name: 'parenthesized sentence ending',
    text: '(Ready?) Next.',
    offsets: [8],
  },
  { name: 'bracketed sentence ending', text: '[Ready.] Next.', offsets: [8] },
  {
    name: 'nested closing punctuation',
    text: '("Ready!") Next.',
    offsets: [10],
  },
  {
    name: 'spaces before closing punctuation',
    text: 'He said "Go!  " Next.',
    offsets: [15],
  },
  { name: 'quoted sentence starter', text: 'Done. "Next."', offsets: [5] },
  { name: 'bracketed sentence starter', text: 'Done. [Next.]', offsets: [5] },
  {
    name: 'parenthesized sentence starter',
    text: 'Done. (Next.)',
    offsets: [5],
  },
  { name: 'Unicode quotation marks', text: '“Done.” ‘Next.’', offsets: [7] },
  {
    name: 'inverted question and exclamation starters',
    text: 'Done? ¿Ready? ¡Go!',
    offsets: [5, 13],
  },
  {
    name: 'Unicode uppercase starters',
    text: 'Done. Élan follows. Ωmega follows.',
    offsets: [5, 19],
  },
  { name: 'Unicode other-letter starters', text: 'Done. 中文。', offsets: [5] },
  { name: 'astral uppercase starters', text: 'Done. 𐐀 follows.', offsets: [5] },
  {
    name: 'Unicode lowercase word before a period',
    text: 'café. Next.',
    offsets: [5],
  },
  {
    name: 'combining mark prevents suffix prefix matching',
    text: 'x́Dr. Smith arrived.',
    offsets: [5],
  },
  {
    name: 'punctuation before a terminal period disables prefix',
    text: 'Dr). Smith arrived.',
    offsets: [4],
  },
  {
    name: 'percent before a terminal period',
    text: '50%. Next.',
    offsets: [4],
  },
  {
    name: 'source offsets preserve leading spaces',
    text: '  First.   Second.  ',
    offsets: [8],
  },
  { name: 'existing line boundaries', text: 'First\nSecond', offsets: [] },
  { name: 'blank lines', text: 'First\n\nSecond', offsets: [] },
  {
    name: 'spaces around line boundaries',
    text: ' First  \n  Second ',
    offsets: [],
  },
  {
    name: 'tabs are not word separators',
    text: 'First.\tSecond.',
    offsets: [],
  },
  {
    name: 'nonbreaking spaces are not word separators',
    text: 'First.\u00a0Second.',
    offsets: [],
  },
  { name: 'outer whitespace', text: '\t First. \t', offsets: [] },
  { name: 'final punctuation without lookahead', text: 'Dr.', offsets: [] },
];

describe('findSentenceEndOffsets', () => {
  for (const { name, text, offsets } of cases) {
    test(name, () => {
      expect([...findSentenceDelimiters(text)]).toEqual(offsets);
    });
  }

  test.each(['No', 'Nos', 'Art', 'Nr', 'pp'])(
    '%s only suppresses a period break before unquoted ASCII digits',
    (prefix: string) => {
      expect([...findSentenceDelimiters(`${prefix}. 42 items. Next.`)]).toEqual([prefix.length + 11]);
      expect([...findSentenceDelimiters(`${prefix}. Next.`)]).toEqual([prefix.length + 1]);
    },
  );

  test('interleaved iterators keep independent positions', () => {
    const first = findSentenceDelimiters('First. Second. Third.');
    const second = findSentenceDelimiters('Hello. World.');

    expect(first.next()).toEqual({ value: 6, done: false });
    expect(second.next()).toEqual({ value: 6, done: false });
    expect(first.next()).toEqual({ value: 14, done: false });
    expect(second.next()).toEqual({ value: undefined, done: true });
    expect(first.next()).toEqual({ value: undefined, done: true });
  });

  test('reports the source offset after an ending without consuming whitespace', () => {
    expect([...findSentenceDelimiters('Hello.  World.')]).toEqual([6]);
  });
});
