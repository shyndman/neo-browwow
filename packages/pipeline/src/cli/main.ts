#!/usr/bin/env bun

import { Crust, defineCommand } from '@crustjs/core';
import { help } from '@crustjs/extensions';

import { judgeEnv, transcriberEnv } from './env';
import { SPEAKABLE_DESCRIPTION, SPEAKABLE_FILE_ARG, runSpeakableCommand } from './speakable';
import {
  TRANSCRIBE_DESCRIPTION,
  TRANSCRIBE_FILE_ARG,
  TRANSCRIBE_PAGES_FLAG_DESCRIPTION,
  pageRangeFlagSchema,
  runTranscribeCommand,
} from './transcribe';

const speakableCommand = defineCommand('speakable', { description: SPEAKABLE_DESCRIPTION }, (command) =>
  command
    .provide(judgeEnv())
    .args(SPEAKABLE_FILE_ARG)
    .action(async ({ args, ctx, signal, stdout }) => {
      await runSpeakableCommand({
        filePath: args.file,
        env: await ctx.judgeEnv,
        signal,
        stdout,
      });
    }),
);

const transcribeCommand = defineCommand('transcribe', { description: TRANSCRIBE_DESCRIPTION }, (command) =>
  command
    .provide(transcriberEnv())
    .args(TRANSCRIBE_FILE_ARG)
    .flags({
      pages: {
        type: 'string',
        schema: pageRangeFlagSchema,
        description: TRANSCRIBE_PAGES_FLAG_DESCRIPTION,
      },
    })
    .action(async ({ args, flags, ctx, signal }) => {
      await runTranscribeCommand({
        filePath: args.file,
        pages: flags.pages,
        env: await ctx.transcriberEnv,
        signal,
      });
    }),
);

const app = new Crust('brow', {
  description: 'Document processing CLI for Browwow.',
})
  .extend(help())
  .add(speakableCommand)
  .add(transcribeCommand);

await app.execute();
