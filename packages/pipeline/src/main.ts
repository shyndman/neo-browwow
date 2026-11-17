import { read } from 'to-vfile';
import { inspect } from 'unist-util-inspect';
import { removePosition } from 'unist-util-remove-position';

import { makeSpeakable } from './pipeline';

const SENTENCE_SPLITTING_URI = new URL('../samples/sentence-splitting.md', import.meta.url);

const file = await read(SENTENCE_SPLITTING_URI, { encoding: 'utf-8' });

try {
  const tree = await makeSpeakable(file);
  removePosition(tree, { force: true });

  console.log(inspect(tree, { color: true }));
} catch (e: unknown) {
  console.error(e);
  if (e instanceof Error) {
    console.error(e.cause);
  }
}
