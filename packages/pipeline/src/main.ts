#!/usr/bin/env bun

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createTypeSafeAi } from '@ai-sdk/typesafe-ai';
import { Crust, defineCommand } from '@crustjs/core';
import { defineEnv } from '@crustjs/env';
import { help } from '@crustjs/extensions';
import { getLogger } from '@logtape/logtape';
import { read } from 'to-vfile';
import { inspect } from 'unist-util-inspect';
import { removePosition } from 'unist-util-remove-position';

import { configureLogging } from './logging';
import { makeSpeakable } from './pipeline';
import { transcribeFile } from './transcribe';

const LLAMA_BASE_URL = 'https://llama.don.haus/v1';
const LLAMA_PROVIDER_NAME = 'llama';
const DECISION_MODEL_ID = 'elephant_1_w6800';
const TRANSCRIPTION_MODEL_ID = '3090_swift_15_qwen38_flash_next-iq3_xxs';

const logger = getLogger(['browwow', 'pipeline', 'main']);

const env = defineEnv('env', {
  LLAMA_BEARER_TOKEN: {
    type: 'string',
    required: true,
    description: 'Bearer token for the local llama model endpoint.',
  },
});

const speakableCommand = defineCommand(
  'speakable',
  {
    description: 'Prepare a Markdown document for speech and inspect its syntax tree.',
  },
  (command) =>
    command
      .use(env)
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

        const { LLAMA_BEARER_TOKEN } = await ctx.env;
        const decisionModel = createTypeSafeAi({
          apiKey: LLAMA_BEARER_TOKEN,
          baseURL: LLAMA_BASE_URL,
        }).decisionModel(DECISION_MODEL_ID);

        try {
          const file = await read(args.file, { encoding: 'utf-8' });
          const tree = await makeSpeakable(file, decisionModel, signal);

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

const transcribeCommand = defineCommand(
  'transcribe',
  {
    description: 'Transcribe a PDF document page by page using a local vision language model.',
  },
  (command) =>
    command
      .use(env)
      .args({
        name: 'file',
        type: 'path',
        required: true,
        description: 'Path to the PDF file to transcribe.',
      })
      .action(async ({ args, ctx, signal }) => {
        await configureLogging();
        logger.info('Running transcribe command for {filePath}.', {
          filePath: args.file,
        });

        const { LLAMA_BEARER_TOKEN } = await ctx.env;
        const transcriptionModel = createOpenAICompatible({
          name: LLAMA_PROVIDER_NAME,
          baseURL: LLAMA_BASE_URL,
          apiKey: LLAMA_BEARER_TOKEN,
          supportsStructuredOutputs: true,
        }).chatModel(TRANSCRIPTION_MODEL_ID);

        try {
          const file = await read(args.file);
          await transcribeFile(file, transcriptionModel, signal);

          logger.info('Completed transcribe command for {filePath}.', {
            filePath: args.file,
          });
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
  .provide(env())
  .add(speakableCommand)
  .add(transcribeCommand);
await app.execute();
