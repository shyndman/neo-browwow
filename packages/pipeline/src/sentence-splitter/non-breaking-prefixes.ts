//
// This is a non-breaking prefix list for the English language.
// The file is used for sentence tokenization (text -> sentence splitting).
//
// The file was taken from Lingua::Sentence package:
//     http://search.cpan.org/~achimru/Lingua-Sentence-1.03/lib/Lingua/Sentence.pm

/**
 * Any element followed by a period (and an upper-case word), does
 * NOT indicate an end-of-sentence marker. Special cases are included for
 * prefixes that ONLY appear before 0 - 9 numbers.
 */
export const NON_BREAKING_PREFIXES = [
  // Any single upper case letter followed by a period is not a sentence ender
  // (excluding I occasionally, but we leave it in). Usually upper case letters
  // are initials in a name.
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
  'M',
  'N',
  'O',
  'P',
  'Q',
  'R',
  'S',
  'T',
  'U',
  'V',
  'W',
  'X',
  'Y',
  'Z',

  // English -- but these work globally for all languages
  'Mr',
  'Mrs',
  'No',
  'pp',
  'St',
  'no',
  'Sr',
  'Jr',
  'Bros',
  'etc',
  'vs',
  'esp',
  'Fig',
  'fig',
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Sept',
  'Oct',
  'Okt',
  'Nov',
  'Dec',
  'Ph.D',
  'PhD',

  'al', // in "et al."
  'cf',
  'Inc',
  'Ms',
  'Gen',
  'Sen',
  'Prof',
  'Dr',
  'Corp',
  'Co',

  // List of titles
  // These are often followed by upper-case names, but do not indicate sentence breaks.
  'Adj',
  'Adm',
  'Adv',
  'Asst',
  'Bart',
  'Bldg',
  'Brig',
  'Bros',
  'Capt',
  'Cmdr',
  'Col',
  'Comdr',
  'Con',
  'Corp',
  'Cpl',
  'DR',
  'Dr',
  'Drs',
  'Ens',
  'Gen',
  'Gov',
  'Hon',
  'Hr',
  'Hosp',
  'Insp',
  'Lt',
  'MM',
  'MR',
  'MRS',
  'MS',
  'Maj',
  'Messrs',
  'Mlle',
  'Mme',
  'Mr',
  'Mrs',
  'Ms',
  'Msgr',
  'Op',
  'Ord',
  'Pfc',
  'Ph',
  'Prof',
  'Pvt',
  'Rep',
  'Reps',
  'Res',
  'Rev',
  'Rt',
  'Sen',
  'Sens',
  'Sfc',
  'Sgt',
  'Sr',
  'St',
  'Supt',
  'Surg',

  // Misc.
  // Odd period-ending items that NEVER indicate breaks (p.m. does NOT fall into
  // this category - it sometimes ends a sentence)
  'v',
  'vs',
  'i.e',
  'rev',
  'e.g',
] as const;

/**
 * These prefixes suppress sentence breaks before unquoted ASCII digits only.
 * Numeric entries take precedence over entries in NON_BREAKING_PREFIXES:
 * "No. 12" stays together, while "No. Thanks." splits into two sentences.
 */
export const NON_BREAKING_NUMBER_PREFIX = ['No', 'Nos', 'Art', 'Nr', 'pp'] as const;
