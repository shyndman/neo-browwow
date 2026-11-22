import { RuleConfigSeverity } from '@commitlint/types';
import type { Plugin, RuleOutcome, UserConfig } from '@commitlint/types';

const PAST_TENSE_SUGGESTIONS: ReadonlyMap<string, string> = new Map([
  ['added', 'add'],
  ['broke', 'break'],
  ['built', 'build'],
  ['changed', 'change'],
  ['cleaned', 'clean'],
  ['configured', 'configure'],
  ['deleted', 'delete'],
  ['disabled', 'disable'],
  ['documented', 'document'],
  ['enabled', 'enable'],
  ['exported', 'export'],
  ['extracted', 'extract'],
  ['fixed', 'fix'],
  ['found', 'find'],
  ['got', 'get'],
  ['handled', 'handle'],
  ['ignored', 'ignore'],
  ['implemented', 'implement'],
  ['installed', 'install'],
  ['kept', 'keep'],
  ['made', 'make'],
  ['migrated', 'migrate'],
  ['modularized', 'modularize'],
  ['moved', 'move'],
  ['ran', 'run'],
  ['refactored', 'refactor'],
  ['removed', 'remove'],
  ['renamed', 'rename'],
  ['replaced', 'replace'],
  ['rewrote', 'rewrite'],
  ['sent', 'send'],
  ['simplified', 'simplify'],
  ['supported', 'support'],
  ['took', 'take'],
  ['updated', 'update'],
  ['validated', 'validate'],
  ['wrote', 'write'],
]);

const IMPERATIVE_ED_ALLOWLIST: ReadonlySet<string> = new Set([
  'embed',
  'feed',
  'heed',
  'need',
  'seed',
  'shed',
  'shred',
  'speed',
]);

const FIRST_WORD_PATTERN = /^([a-zA-Z]+)/u;

const UPPERCASE_START_PATTERN = /^[A-Z]/u;

const checkSubjectLowercaseStart = (subject: string | null): RuleOutcome => {
  if (subject === null || subject.length === 0) {
    return [true];
  }

  if (UPPERCASE_START_PATTERN.test(subject)) {
    return [false, 'subject must not start with a capital letter'];
  }

  return [true];
};

const checkSubjectImperative = (subject: string | null): RuleOutcome => {
  if (subject === null || subject.length === 0) {
    return [true];
  }

  const match = FIRST_WORD_PATTERN.exec(subject);
  const rawFirstWord = match?.[1];

  if (rawFirstWord === undefined || rawFirstWord.length === 0) {
    return [true];
  }

  const firstWord = rawFirstWord.toLowerCase();
  const suggestion = PAST_TENSE_SUGGESTIONS.get(firstWord);

  if (suggestion !== undefined) {
    return [false, `subject must use imperative mood: use "${suggestion}" instead of "${rawFirstWord}"`];
  }

  if (firstWord.endsWith('ed') && !IMPERATIVE_ED_ALLOWLIST.has(firstWord)) {
    return [false, `subject must use imperative mood, not past tense ("${rawFirstWord}")`];
  }

  return [true];
};

const subjectStylePlugin: Plugin = {
  rules: {
    'subject-lowercase-start': (parsed): RuleOutcome => checkSubjectLowercaseStart(parsed.subject),
    'subject-imperative': (parsed): RuleOutcome => checkSubjectImperative(parsed.subject),
  },
};

const config: UserConfig = {
  extends: ['@commitlint/config-conventional'],
  plugins: [subjectStylePlugin],
  rules: {
    'subject-case': [RuleConfigSeverity.Disabled],
    'subject-lowercase-start': [RuleConfigSeverity.Error, 'always'],
    'subject-imperative': [RuleConfigSeverity.Error, 'always'],
  },
};

export default config;
