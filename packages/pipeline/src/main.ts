import { createTypeSafeAi } from '@ai-sdk/typesafe-ai';
import { configure, getAnsiColorFormatter, getConsoleSink, getLogger } from '@logtape/logtape';
import { read } from 'to-vfile';
import { inspect } from 'unist-util-inspect';
import { removePosition } from 'unist-util-remove-position';

import { makeSpeakable } from './pipeline';

await configure({
  sinks: {
    console: getConsoleSink({
      formatter: getAnsiColorFormatter({ sourceLocation: true }),
    }),
  },
  loggers: [
    {
      category: ['logtape', 'meta'],
      lowestLevel: 'warning',
      sinks: ['console'],
    },
    {
      category: ['browwow'],
      lowestLevel: 'debug',
      sinks: ['console'],
      captureSourceLocation: true,
    },
  ],
});

const logger = getLogger(['browwow', 'pipeline', 'main']);

const SENTENCE_SPLITTING_URI = new URL('../samples/advancing_sustainability_science.md', import.meta.url);

console.log(process.env);
const file = await read(SENTENCE_SPLITTING_URI, { encoding: 'utf-8' });
const decisionModel = createTypeSafeAi({
  apiKey: process.env.LLAMA_BEARER_TOKEN,
  baseURL: 'https://llama.don.haus/v1',
}).decisionModel('elephant_1_w6800');

try {
  const tree = await makeSpeakable(file, decisionModel);
  removePosition(tree, { force: true });

  console.log(inspect(tree, { color: true }));
} catch (error: unknown) {
  logger.error('Pipeline execution failed: {error} (cause: {cause}).', {
    error,
    cause: error instanceof Error ? error.cause : undefined,
  });
}
