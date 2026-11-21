import { getLogger } from '@logtape/logtape';
import { type Experimental_DecisionModel, experimental_decide } from 'ai';
import type { Root } from 'mdast';

import type { DocumentType } from '../mdast';
import { sampleDocumentForClassification } from './sample';

const logger = getLogger(['browwow', 'pipeline', 'classify']);

const FULL_DOCUMENT_INSTRUCTIONS =
  'Classify the document in `content` into the single document type that best matches its editorial form and structure.';

const SAMPLED_DOCUMENT_INSTRUCTIONS =
  'Classify the document into the single document type that best matches its editorial form and structure. `beginning`, `middle`, and `end` are excerpts from the start, midpoint, and end of the same document.';

const DOCUMENT_TYPE_CRITERIA: Readonly<Record<DocumentType, string>> = {
  research_paper:
    'A formal scholarly research paper, preprint, review article, or journal editorial presenting research methods, results, analysis, or scholarly synthesis in an academic structure such as affiliations, an abstract, sections, inline citations, or references.',
  blog_post:
    'An informal or personal web post, essay, or tutorial, often conversational, opinionated, or published under an individual or company blog byline rather than as a formal scholarly publication, news report, technical manual, or reference entry.',
  encyclopedia_entry:
    'A reference entry that defines or surveys a topic, person, place, event, or concept for general or scholarly reference, including authored academic encyclopedia entries with bibliographies.',
  news_article:
    'A journalistic report about recent or current events, typically focused on who, what, when, where, why, or developing information.',
  other:
    'Writing that fits none of the other types, including software or API documentation, READMEs, fiction, correspondence, legal, marketing, administrative, or miscellaneous material.',
};

const JUDGE_MAX_RETRIES = 10;

/**
 * Classifies the parsed document into a {@link DocumentType} from a bounded
 * sample of source content.
 */
export async function classifyDocument(
  tree: Root,
  judge: Experimental_DecisionModel,
  abortSignal?: AbortSignal,
): Promise<DocumentType> {
  abortSignal?.throwIfAborted();

  const state = sampleDocumentForClassification(tree);

  if (state === null) {
    logger.info('Document contains no extractable source content; classifying as other.');
    return 'other';
  }

  const isSampled = 'beginning' in state;
  const startedAt = performance.now();

  logger.info('Classifying {mode} document.', { mode: isSampled ? 'sampled' : 'full' });

  try {
    const result = await experimental_decide({
      model: judge,
      state,
      questions: {
        documentType: {
          type: 'choice',
          instructions: isSampled ? SAMPLED_DOCUMENT_INSTRUCTIONS : FULL_DOCUMENT_INSTRUCTIONS,
          criteria: DOCUMENT_TYPE_CRITERIA,
        },
      },
      maxRetries: JUDGE_MAX_RETRIES,
      abortSignal,
    });

    abortSignal?.throwIfAborted();

    const answer = result.answers.documentType;

    logger.info(
      'Classified document as {documentType} in {elapsedMs}ms via {modelId} (probabilities: {probabilities}, usage: {usage}).',
      {
        documentType: answer.choice,
        elapsedMs: Math.round(performance.now() - startedAt),
        modelId: result.response.modelId,
        probabilities: answer.probabilities,
        usage: result.usage,
      },
    );

    return answer.choice;
  } catch (cause: unknown) {
    abortSignal?.throwIfAborted();
    throw new Error('Failed to classify document', { cause });
  }
}
