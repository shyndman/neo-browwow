import type { Node } from 'mdast';
import type { VFile } from 'vfile';

import { parseFile } from './parse';

export async function makeSpeakable(markdownFile: VFile): Promise<Node> {
  const tree = await parseFile(markdownFile);

  return tree;
}
