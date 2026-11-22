import { createTypeSafeAi } from '@ai-sdk/typesafe-ai';
import { getLogger } from '@logtape/logtape';
import { read } from 'to-vfile';
import { inspect } from 'unist-util-inspect';
import { removePosition } from 'unist-util-remove-position';

import { configureLogging } from '../logging';
import { makeSpeakable } from '../pipeline';
import type { JudgeEnv } from './env';

const JUDGE_MODEL_ID = 'elephant_1_w6800';

const logger = getLogger(['browwow', 'pipeline', 'cli', 'speakable']);

export const SPEAKABLE_DESCRIPTION = 'Prepare a Markdown document for speech and inspect its syntax tree.';

export const SPEAKABLE_FILE_ARG = {
  name: 'file',
  type: 'path',
  required: true,
  description: 'Path to the Markdown file to process.',
} as const;

export interface SpeakableCommandInput {
  readonly filePath: string;
  readonly env: JudgeEnv;
  readonly signal: AbortSignal;
  readonly stdout: (chunk: string) => void;
}

export async function runSpeakableCommand({
  filePath,
  env,
  signal,
  stdout,
}: SpeakableCommandInput): Promise<void> {
  await configureLogging();
  logger.info('Running speakable command for {filePath}.', { filePath });

  const judge = createTypeSafeAi({
    apiKey: env.JUDGE_BEARER_TOKEN,
    baseURL: env.JUDGE_BASE_URL.href,
  }).decisionModel(JUDGE_MODEL_ID);

  try {
    const file = await read(filePath, { encoding: 'utf-8' });
    const tree = await makeSpeakable(file, judge, signal);

    removePosition(tree, { force: true });
    stdout(inspect(tree, { color: true }));

    logger.info('Completed speakable command for {filePath}.', { filePath });
  } catch (error: unknown) {
    logger.error('Pipeline execution failed: {error} (cause: {cause}).', {
      error,
      cause: error instanceof Error ? error.cause : undefined,
    });
    throw error;
  }
}
