import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { getLogger } from '@logtape/logtape';
import {
  type MultiIntegerRange,
  min as minPage,
  parse as parsePageRange,
  stringify as stringifyPageRange,
} from 'multi-integer-range';
import { read } from 'to-vfile';
import { z } from 'zod';

import { configureLogging } from '../logging';
import { transcribeFile } from '../transcribe/index';
import type { TranscriberEnv } from './env';

const TRANSCRIBER_PROVIDER_NAME = 'transcriber';
const TRANSCRIBER_MODEL_ID = '3090_swift_15_qwen38_flash_next-iq3_xxs_16k';

const logger = getLogger(['browwow', 'pipeline', 'cli', 'transcribe']);

export const TRANSCRIBE_DESCRIPTION = 'Transcribe a PDF document page by page using the transcriber.';

export const TRANSCRIBE_FILE_ARG = {
  name: 'file',
  type: 'path',
  required: true,
  description: 'Path to the PDF file to transcribe.',
} as const;

export const TRANSCRIBE_PAGES_FLAG_DESCRIPTION =
  'Pages or ranges to transcribe (e.g., 1-4 or 1,2,3,6-8). Defaults to all pages.';

export const pageRangeFlagSchema: z.ZodType<MultiIntegerRange | undefined, string | undefined> = z
  .string()
  .optional()
  .transform((value, ctx): MultiIntegerRange | undefined => {
    if (value === undefined) {
      return undefined;
    }

    try {
      const pages = parsePageRange(value);
      const firstPage = minPage(pages);

      if (firstPage === undefined || firstPage < 1) {
        ctx.addIssue({
          code: 'custom',
          message: 'Pages must contain at least one positive 1-based page number.',
        });
        return z.NEVER;
      }

      return pages;
    } catch (error: unknown) {
      ctx.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : 'Invalid page range.',
      });
      return z.NEVER;
    }
  });

export interface TranscribeCommandInput {
  readonly filePath: string;
  readonly pages: MultiIntegerRange | undefined;
  readonly env: TranscriberEnv;
  readonly signal: AbortSignal;
}

export async function runTranscribeCommand({
  filePath,
  pages,
  env,
  signal,
}: TranscribeCommandInput): Promise<void> {
  await configureLogging();

  const pagesLabel = pages === undefined ? 'all' : stringifyPageRange(pages);

  logger.info('Running transcribe command for {filePath} (pages: {pages}).', {
    filePath,
    pages: pagesLabel,
  });

  const transcriber = createOpenAICompatible({
    name: TRANSCRIBER_PROVIDER_NAME,
    baseURL: env.TRANSCRIBER_BASE_URL.href,
    apiKey: env.TRANSCRIBER_BEARER_TOKEN,
    supportsStructuredOutputs: true,
  }).chatModel(TRANSCRIBER_MODEL_ID);

  try {
    const file = await read(filePath);
    await transcribeFile(file, transcriber, { pages, abortSignal: signal });

    logger.info('Completed transcribe command for {filePath}.', { filePath });
  } catch (error: unknown) {
    logger.error('Transcription execution failed: {error} (cause: {cause}).', {
      error,
      cause: error instanceof Error ? error.cause : undefined,
    });
    throw error;
  }
}
