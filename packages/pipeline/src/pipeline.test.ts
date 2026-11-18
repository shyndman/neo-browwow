import { expect, test } from 'bun:test';

import { Experimental_DecisionMockModelV4 } from 'ai/test';
import { VFile } from 'vfile';

import { makeSpeakable } from './pipeline';

test('splits text leaves in place, attaches spans, and classifies document type on root', async () => {
  const model = new Experimental_DecisionMockModelV4({
    modelId: 'jev-test',
    doDecide: () =>
      Promise.resolve({
        answers: {
          documentType: {
            type: 'choice',
            choice: 'research_paper',
          },
        },
        warnings: [],
      }),
  });

  const tree = await makeSpeakable(
    new VFile('Intro *First (Kingma, 2015). Second [1, 2]. Third.* Last. (See Note 1. Also Note 2.)'),
    model,
  );

  expect(tree.data?.documentType).toBe('research_paper');
  expect(tree).toMatchObject({
    children: [
      {
        type: 'paragraph',
        children: [
          { type: 'text', value: 'Intro ' },
          {
            type: 'emphasis',
            children: [
              { type: 'text', value: 'First ' },
              { type: 'text', value: '(Kingma, 2015)' },
              { type: 'text', value: '.' },
              { type: 'text', value: ' Second ' },
              { type: 'text', value: '[1, 2]' },
              { type: 'text', value: '.' },
              { type: 'text', value: ' Third.' },
            ],
          },
          { type: 'text', value: ' Last.' },
          { type: 'text', value: ' ' },
          { type: 'text', value: '(See Note 1.' },
          { type: 'text', value: ' Also Note 2.)' },
        ],
      },
    ],
  });
});
