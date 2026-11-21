#!/usr/bin/env bun

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createTypeSafeAi } from '@ai-sdk/typesafe-ai';
import { Crust, defineCommand } from '@crustjs/core';
import { defineEnv } from '@crustjs/env';
import { help } from '@crustjs/extensions';
import { getLogger } from '@logtape/logtape';
import {
  type MultiIntegerRange,
  min as minPage,
  parse as parsePageRange,
  stringify as stringifyPageRange,
} from 'multi-integer-range';
import { read } from 'to-vfile';
import { inspect } from 'unist-util-inspect';
import { removePosition } from 'unist-util-remove-position';
import { z } from 'zod';

import { configureLogging } from './logging';
import { makeSpeakable } from './pipeline';
import { transcribeFile } from './transcribe';

const TRANSCRIBER_PROVIDER_NAME = 'transcriber';
const JUDGE_MODEL_ID = 'elephant_1_w6800';
const TRANSCRIBER_MODEL_ID = '3090_swift_15_qwen38_flash_next-iq3_xxs';

const logger = getLogger(['browwow', 'pipeline', 'main']);

const judgeEnv = defineEnv('judgeEnv', {
  JUDGE_BASE_URL: {
    type: 'string',
    required: true,
    description: 'Base URL for the judge endpoint.',
  },
  JUDGE_BEARER_TOKEN: {
    type: 'string',
    required: true,
    description: 'Bearer token for the judge endpoint.',
  },
});

const transcriberEnv = defineEnv('transcriberEnv', {
  TRANSCRIBER_BASE_URL: {
    type: 'string',
    required: true,
    description: 'Base URL for the transcriber endpoint.',
  },
  TRANSCRIBER_BEARER_TOKEN: {
    type: 'string',
    required: true,
    description: 'Bearer token for the transcriber endpoint.',
  },
});

const speakableCommand = defineCommand(
  'speakable',
  {
    description: 'Prepare a Markdown document for speech and inspect its syntax tree.',
  },
  (command) =>
    command
      .provide(judgeEnv())
      .args({
        name: 'file',
        type: 'path',
        required: true,
        description: 'Path to the Markdown file to process.',
      })
      .action(async ({ args, ctx, signal, stdout }) => {
        await configureLogging();
        logger.info('Running speakable command for {filePath}.', {
          filePath: args.file,
        });

        const { JUDGE_BASE_URL, JUDGE_BEARER_TOKEN } = await ctx.judgeEnv;
        const judge = createTypeSafeAi({
          apiKey: JUDGE_BEARER_TOKEN,
          baseURL: JUDGE_BASE_URL,
        }).decisionModel(JUDGE_MODEL_ID);

        try {
          const file = await read(args.file, { encoding: 'utf-8' });
          const tree = await makeSpeakable(file, judge, signal);

          removePosition(tree, { force: true });
          stdout(inspect(tree, { color: true }));

          logger.info('Completed speakable command for {filePath}.', {
            filePath: args.file,
          });
        } catch (error: unknown) {
          logger.error('Pipeline execution failed: {error} (cause: {cause}).', {
            error,
            cause: error instanceof Error ? error.cause : undefined,
          });
          throw error;
        }
      }),
);

const pageRangeFlagSchema = z
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

const transcribeCommand = defineCommand(
  'transcribe',
  {
    description: 'Transcribe a PDF document page by page using the transcriber.',
  },
  (command) =>
    command
      .provide(transcriberEnv())
      .args({
        name: 'file',
        type: 'path',
        required: true,
        description: 'Path to the PDF file to transcribe.',
      })
      .flags({
        pages: {
          type: 'string',
          schema: pageRangeFlagSchema,
          description: 'Pages or ranges to transcribe (e.g., 1-4 or 1,2,3,6-8). Defaults to all pages.',
        },
      })
      .action(async ({ args, flags, ctx, signal }) => {
        await configureLogging();

        const pagesLabel = flags.pages === undefined ? 'all' : stringifyPageRange(flags.pages);

        logger.info('Running transcribe command for {filePath} (pages: {pages}).', {
          filePath: args.file,
          pages: pagesLabel,
        });

        const { TRANSCRIBER_BASE_URL, TRANSCRIBER_BEARER_TOKEN } = await ctx.transcriberEnv;
        const transcriber = createOpenAICompatible({
          name: TRANSCRIBER_PROVIDER_NAME,
          baseURL: TRANSCRIBER_BASE_URL,
          apiKey: TRANSCRIBER_BEARER_TOKEN,
          supportsStructuredOutputs: true,
        }).chatModel(TRANSCRIBER_MODEL_ID);

        try {
          const file = await read(args.file);
          await transcribeFile(file, transcriber, { pages: flags.pages, abortSignal: signal });

          logger.info('Completed transcribe command for {filePath}.', { filePath: args.file });
        } catch (error: unknown) {
          logger.error('Transcription execution failed: {error} (cause: {cause}).', {
            error,
            cause: error instanceof Error ? error.cause : undefined,
          });
          throw error;
        }
      }),
);

const app = new Crust('brow', {
  description: 'Document processing CLI for Browwow.',
})
  .extend(help())
  .add(speakableCommand)
  .add(transcribeCommand);
await app.execute();
