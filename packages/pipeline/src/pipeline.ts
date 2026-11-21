import { getLogger } from '@logtape/logtape';
import type { Experimental_DecisionModel } from 'ai';
import type { Root } from 'mdast';
import type { VFile } from 'vfile';

import { classifyDocument } from './classify/index';
import { RootMetadata } from './mdast';
import { parseFile } from './parse';

const logger = getLogger(['browwow', 'pipeline']);

export async function makeSpeakable(
  markdownFile: VFile,
  judge: Experimental_DecisionModel,
  abortSignal?: AbortSignal,
): Promise<Root> {
  abortSignal?.throwIfAborted();

  const sourceLabel = markdownFile.path || '<inline>';

  logger.info('Preparing speakable document for {source}.', {
    source: sourceLabel,
  });

  const tree = await parseFile(markdownFile);
  const documentType = await classifyDocument(tree, judge, abortSignal);

  RootMetadata.attach(tree, documentType);

  logger.info('Finished speakable preparation for {source} ({documentType}).', {
    source: sourceLabel,
    documentType,
  });

  return tree;
}
