import { NON_BREAKING_NUMBER_PREFIX, NON_BREAKING_PREFIXES } from './non-breaking-prefixes';

const numericPrefixes: ReadonlySet<string> = new Set(NON_BREAKING_NUMBER_PREFIX);
const nonBreakingPrefixes: ReadonlySet<string> = new Set(
  NON_BREAKING_PREFIXES.filter((prefix) => !numericPrefixes.has(prefix)),
);

// Prefer complete quoted endings over the fallback for bare periods.
const punctuationBreaks: readonly RegExp[] = [
  /[?!](?= +['"([¿¡\p{Initial_Punctuation}]*[\p{Uppercase_Letter}\p{Other_Letter}])/u,
  /\.{2,}(?= +['"([¿¡\p{Initial_Punctuation}]*[\p{Uppercase_Letter}\p{Other_Letter}])/u,
  /[?!.] *['")\]\p{Final_Punctuation}]+(?= +['"([¿¡\p{Initial_Punctuation}]* *[\p{Uppercase_Letter}\p{Other_Letter}])/u,
  /[?!.](?= +['"[¿¡\p{Initial_Punctuation}]+ *[\p{Uppercase_Letter}\p{Other_Letter}])/u,
];
const sentenceEnd = new RegExp(
  `(${punctuationBreaks.map((pattern) => pattern.source).join('|')})|(\\.+)(?= +([^ ]+))`,
  'gu',
);

// Python regex's Unicode-aware \w includes marks and join controls; JS \w does not.
const terminalPeriod =
  /((?:[\p{Alphabetic}\p{Mark}\p{Decimal_Number}\p{Connector_Punctuation}.-]|\u200c|\u200d)*)(['")\]%\p{Final_Punctuation}]*)(\.+)$/u;
const acronymEnding = /\.[\p{Uppercase_Letter}\p{Other_Letter}-]+\.+$/u;
const sentenceStarter = /^ *['"([¿¡\p{Initial_Punctuation}]* *[\p{Uppercase_Letter}\p{Other_Letter}0-9]/u;
const numericStarter = /^[0-9]+/u;

/**
 * Yield UTF-16 offsets immediately after sentence endings between sentences.
 * Offsets include closing punctuation and leave following whitespace untouched.
 * The remaining suffix belongs to the caller; no end-of-input offset is emitted.
 */
export function* findSentenceDelimiters(text: string): Generator<number, void, undefined> {
  for (const match of text.matchAll(sentenceEnd)) {
    const end = match.index + match[0].length;

    if (match[1] !== undefined) {
      yield end;
      continue;
    }

    const wordStart = text.lastIndexOf(' ', match.index - 1) + 1;
    const word = text.slice(wordStart, end);

    if (shouldBreakAfter(word, match[3])) {
      yield end;
    }
  }
}

/**
 * Checks bare period endings after the punctuation alternatives. A break requires
 * a possible sentence starter; known prefixes and acronym endings stay together.
 * Numeric-only prefixes stay together only before unquoted ASCII digits.
 */
function shouldBreakAfter(word: string, nextWord: string): boolean {
  const match = terminalPeriod.exec(word);

  if (match === null) {
    return false;
  }

  // Both captures always participate, including when they match an empty string.
  const prefix = match[1];
  const closingPunctuation = match[2];
  const barePrefix = closingPunctuation === '';

  if (barePrefix && nonBreakingPrefixes.has(prefix)) {
    return false;
  }
  if (acronymEnding.test(word) || !sentenceStarter.test(nextWord)) {
    return false;
  }

  return !(barePrefix && numericPrefixes.has(prefix) && numericStarter.test(nextWord));
}
