import { expect, test } from 'bun:test';

import { VFile } from 'vfile';

import { makeSpeakable } from './pipeline';

test('cleaves text leaves in place and attaches sentence and parenthetical spans', async () => {
  const tree = await makeSpeakable(
    new VFile('Intro *First (Kingma, 2015). Second [1, 2]. Third.* Last. (See Note 1. Also Note 2.)'),
  );

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
