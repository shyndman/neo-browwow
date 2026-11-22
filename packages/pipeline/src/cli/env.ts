import type { ContextFactory } from '@crustjs/core';
import { defineEnv } from '@crustjs/env';

export interface JudgeEnv {
  readonly JUDGE_BASE_URL: URL;
  readonly JUDGE_BEARER_TOKEN: string;
}

export interface TranscriberEnv {
  readonly TRANSCRIBER_BASE_URL: URL;
  readonly TRANSCRIBER_BEARER_TOKEN: string;
}

export const judgeEnv: ContextFactory<'judgeEnv', void, JudgeEnv> = defineEnv('judgeEnv', {
  JUDGE_BASE_URL: {
    type: 'url',
    required: true,
    description: 'Base URL for the judge endpoint (e.g. https://judge.example.com/v1).',
  },
  JUDGE_BEARER_TOKEN: {
    type: 'string',
    required: true,
    description: 'Bearer token for the judge endpoint.',
  },
});

export const transcriberEnv: ContextFactory<'transcriberEnv', void, TranscriberEnv> = defineEnv(
  'transcriberEnv',
  {
    TRANSCRIBER_BASE_URL: {
      type: 'url',
      required: true,
      description: 'Base URL for the transcriber endpoint (e.g. https://transcriber.example.com/v1).',
    },
    TRANSCRIBER_BEARER_TOKEN: {
      type: 'string',
      required: true,
      description: 'Bearer token for the transcriber endpoint.',
    },
  },
);
