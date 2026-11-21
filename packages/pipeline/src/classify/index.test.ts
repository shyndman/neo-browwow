import { describe, expect, test } from 'bun:test';

import { APICallError } from 'ai';
import { Experimental_DecisionMockModelV4 } from 'ai/test';
import { VFile } from 'vfile';

import type { DocumentType } from '../mdast';
import { parseFile } from '../parse';
import { classifyDocument } from './index';

type CapturedDecisionCall = Parameters<Experimental_DecisionMockModelV4['doDecide']>[0];

interface MockClassifier {
  readonly model: Experimental_DecisionMockModelV4;
  readonly calls: CapturedDecisionCall[];
}

function createMockClassifier(selectedType: DocumentType): MockClassifier {
  const calls: CapturedDecisionCall[] = [];
  const model = new Experimental_DecisionMockModelV4({
    modelId: 'jev-test',
    doDecide: (options) => {
      calls.push(options);
      return Promise.resolve({
        answers: {
          documentType: {
            type: 'choice',
            choice: selectedType,
          },
        },
        warnings: [],
      });
    },
  });

  return { model, calls };
}

function makeNumberedWords(prefix: string, count: number): string {
  return Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`).join(' ');
}

describe('classifyDocument', () => {
  test('classifies a short document whole using content-only instructions', async () => {
    const tree = await parseFile(
      new VFile(
        '# Advancing Sustainability Science\n\n## Introduction\n\nWe evaluate Agenda 2030 (UN 2015).',
      ),
    );
    const { model, calls } = createMockClassifier('research_paper');

    const documentType = await classifyDocument(tree, model);

    expect(documentType).toBe('research_paper');
    expect(calls).toHaveLength(1);

    const call = calls[0];

    expect(call.state).toEqual([
      {
        type: 'json',
        value: {
          content: 'Advancing Sustainability Science\n\nIntroduction\n\nWe evaluate Agenda 2030 (UN 2015).',
        },
      },
    ]);

    const question = call.questions.documentType;

    expect(question?.type).toBe('choice');
    if (question?.type === 'choice') {
      expect(question.instructions).toContain('content');
      expect(question.instructions).not.toContain('beginning');
      expect(Object.keys(question.criteria)).toEqual([
        'research_paper',
        'blog_post',
        'encyclopedia_entry',
        'news_article',
        'other',
      ]);
    }
  });

  test('extracts Markdown tables, caption directives, code, math, lists, quotes, and footnotes while omitting image alt and HTML', async () => {
    const markdown = [
      '# Empirical Results',
      '',
      'Mark Smith<sup>1</sup> reports $\\alpha = 0.05$ using `fitModel()`[^1]. ![Generated chart alt](chart.png)',
      '',
      '$$',
      'L(\\theta) = \\sum_i y_i',
      '$$',
      '',
      '```python',
      'def run(): pass',
      '```',
      '',
      '| Dataset | Score |',
      '| --- | --- |',
      '| CIFAR-10 | 94.2 |',
      '',
      ':::caption',
      'Table 1: Ablation results.',
      ':::',
      '',
      '::caption[Figure 1: Pipeline overview.]',
      '',
      ':::note',
      'Ignored non-caption directive.',
      ':::',
      '',
      '::badge[Ignored leaf directive]',
      '',
      '<div>Ignored HTML block</div>',
      '',
      '> Quoted finding.',
      '',
      '- First item',
      '- Second item',
      '',
      '[^1]: Statistical significance note.',
    ].join('\n');

    const tree = await parseFile(new VFile(markdown));
    const { model, calls } = createMockClassifier('research_paper');

    await classifyDocument(tree, model);

    const stateValue = calls[0].state[0];

    expect(stateValue).toEqual({
      type: 'json',
      value: {
        content: [
          'Empirical Results',
          'Mark Smith1 reports \\alpha = 0.05 using fitModel().',
          'L(\\theta) = \\sum_i y_i',
          'def run(): pass',
          'Dataset',
          'Score',
          'CIFAR-10',
          '94.2',
          'Table 1: Ablation results.',
          'Figure 1: Pipeline overview.',
          'Quoted finding.',
          'First item',
          'Second item',
          'Statistical significance note.',
        ].join('\n\n'),
      },
    });
  });

  test('samples documents over 400 content words from sections at 0, len/2, and len-1 walking forward until budget or next selected section', async () => {
    const markdown = [
      'Special Feature Banner',
      '',
      '# Paper Title',
      '',
      makeNumberedWords('intro', 180),
      '',
      '## Background',
      '',
      makeNumberedWords('bg', 80),
      '',
      '## Methods Overview',
      '',
      makeNumberedWords('method', 70),
      '',
      '## Experiments',
      '',
      makeNumberedWords('exp', 80),
      '',
      '## References',
      '',
      makeNumberedWords('ref', 150),
    ].join('\n');

    const tree = await parseFile(new VFile(markdown));
    const { model, calls } = createMockClassifier('research_paper');

    await classifyDocument(tree, model);

    const call = calls[0];
    const question = call.questions.documentType;

    expect(question?.type).toBe('choice');
    if (question?.type === 'choice') {
      expect(question.instructions).toContain('beginning');
      expect(question.instructions).toContain('middle');
      expect(question.instructions).toContain('end');
      expect(question.instructions).not.toContain('`content`');
    }

    const statePart = call.state[0];

    expect(statePart?.type).toBe('json');
    if (statePart?.type === 'json') {
      const sample = statePart.value as {
        beginning: string;
        middle: string;
        end: string;
      };

      expect(sample.beginning).toBe(
        ['Special Feature Banner', `Paper Title\n\n${makeNumberedWords('intro', 157)}`].join('\n\n'),
      );
      expect(sample.middle).toBe(
        [
          `Methods Overview\n\n${makeNumberedWords('method', 70)}`,
          `Experiments\n\n${makeNumberedWords('exp', 50)}`,
        ].join('\n\n'),
      );
      expect(sample.end).toBe(`References\n\n${makeNumberedWords('ref', 120)}`);
    }
  });

  test('stops walking forward when reaching the next selected section even if under word budget', async () => {
    const markdown = [
      '# Short Intro',
      '',
      makeNumberedWords('intro', 20),
      '',
      '## Middle Section',
      '',
      makeNumberedWords('mid', 30),
      '',
      '## Long References',
      '',
      makeNumberedWords('ref', 380),
    ].join('\n');

    const tree = await parseFile(new VFile(markdown));
    const { model, calls } = createMockClassifier('research_paper');

    await classifyDocument(tree, model);

    const statePart = calls[0].state[0];

    expect(statePart?.type).toBe('json');
    if (statePart?.type === 'json') {
      const sample = statePart.value as {
        beginning: string;
        middle: string;
        end: string;
      };

      expect(sample.beginning).toBe(`Short Intro\n\n${makeNumberedWords('intro', 20)}`);
      expect(sample.middle).toBe(`Middle Section\n\n${makeNumberedWords('mid', 30)}`);
      expect(sample.end).toBe(`Long References\n\n${makeNumberedWords('ref', 120)}`);
    }
  });

  test('returns other without calling the decision model when the document has no extractable sections', async () => {
    const tree = await parseFile(new VFile('![Ignored diagram description](diagram.png)\n\n---\n'));
    const { model, calls } = createMockClassifier('research_paper');

    const documentType = await classifyDocument(tree, model);

    expect(documentType).toBe('other');
    expect(calls).toHaveLength(0);
  });

  test('propagates abort reason before and after the decision model call', async () => {
    const tree = await parseFile(new VFile('# Headline\n\nBreaking event details.'));

    const preAbortReason = new Error('Pre-aborted');
    const preAbortedController = new AbortController();
    preAbortedController.abort(preAbortReason);

    const { model: uncalledModel, calls } = createMockClassifier('news_article');

    let preAbortError: unknown;

    try {
      await classifyDocument(tree, uncalledModel, preAbortedController.signal);
    } catch (error: unknown) {
      preAbortError = error;
    }

    expect(preAbortError).toBe(preAbortReason);
    expect(calls).toHaveLength(0);

    const postAbortReason = new Error('Aborted during decision');
    const midFlightController = new AbortController();
    const midFlightModel = new Experimental_DecisionMockModelV4({
      modelId: 'jev-test',
      doDecide: () => {
        midFlightController.abort(postAbortReason);
        return Promise.resolve({
          answers: {
            documentType: {
              type: 'choice',
              choice: 'news_article',
            },
          },
          warnings: [],
        });
      },
    });

    let postAbortError: unknown;

    try {
      await classifyDocument(tree, midFlightModel, midFlightController.signal);
    } catch (error: unknown) {
      postAbortError = error;
    }

    expect(postAbortError).toBe(postAbortReason);
  });

  test('wraps non-retryable decision model failures in an Error with cause', async () => {
    const tree = await parseFile(new VFile('# Post\n\nPersonal reflections on software.'));
    const upstreamFailure = new APICallError({
      message: 'Unauthorized',
      url: 'https://api.typesafe.ai/v1/systemone',
      requestBodyValues: {},
      statusCode: 401,
      isRetryable: false,
    });
    const failingModel = new Experimental_DecisionMockModelV4({
      modelId: 'jev-test',
      doDecide: () => Promise.reject(upstreamFailure),
    });

    let caughtError: unknown;

    try {
      await classifyDocument(tree, failingModel);
    } catch (error: unknown) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(Error);
    if (caughtError instanceof Error) {
      expect(caughtError.message).toBe('Failed to classify document');
      expect(caughtError.cause).toBe(upstreamFailure);
    }
  });
});
