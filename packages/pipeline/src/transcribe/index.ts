import { getLogger } from '@logtape/logtape';
import { type LanguageModel, Output, generateText } from 'ai';
import {
  type MultiIntegerRange,
  iterate as iteratePages,
  length as pageRangeLength,
  max as maxPage,
  min as minPage,
  stringify as stringifyPageRange,
} from 'multi-integer-range';
import { getDocumentProxy, renderPageAsImage } from 'unpdf';
import type { VFile } from 'vfile';
import { z } from 'zod';

import * as iterables from '../foundation/iterables';

const logger = getLogger(['browwow', 'pipeline', 'transcribe']);

const TRANSCRIBER_SYSTEM_PROMPT = `
  Transcribe the following page image into Markdown format.

  * Use extended syntax for footnotes.
  * Tables, including those with colspans and rowspans are supported.
  * Omit headers and non-footnote footers.
  * Do not include any HTML. You are not attempting to recreate the PDF's layout in Markdown.
`;
const MAX_CONCURRENT_TRANSCRIPTIONS = 5;
const TRANSCRIBER_MAX_RETRIES = 5;
const PAGE_RENDER_SCALE = 2;
const PNG_MEDIA_TYPE = 'image/png';

const pageTranscriptionSchema = z.object({
  transcribedMarkdown: z.string(),
  notes: z.string().optional().describe('Any issues noticed while transcribing the page.'),
});

export interface PageTranscription {
  readonly transcribedMarkdown: string;
  readonly notes?: string;
}

export interface TranscribeFileOptions {
  readonly pages?: MultiIntegerRange;
  readonly abortSignal?: AbortSignal;
}

interface PdfContext {
  readonly pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  readonly totalPages: number;
  readonly sourceLabel: string;
}

export async function transcribeFile(
  pdfFile: VFile,
  transcriber: LanguageModel,
  options: TranscribeFileOptions = {},
): Promise<PageTranscription[]> {
  const { pages, abortSignal } = options;

  abortSignal?.throwIfAborted();

  const sourceLabel = pdfFile.path || '<inline>';
  const pdfBytes = readPdfBytes(pdfFile, sourceLabel);

  logger.info('Starting PDF transcription for {source} ({byteLength} bytes).', {
    source: sourceLabel,
    byteLength: pdfBytes.byteLength,
  });

  const pdf = await getDocumentProxy(pdfBytes);
  const transcriptions: PageTranscription[] = [];

  try {
    const totalPages = pdf.numPages;
    const selectedPages = resolvePageRange(pages, totalPages, sourceLabel);
    const pdfContext: PdfContext = { pdf, totalPages, sourceLabel };

    logger.info(
      'Opened PDF {source} with {totalPages} pages; transcribing {selectedCount} ({pageSpec}) in batches of {batchSize}.',
      {
        source: sourceLabel,
        totalPages,
        selectedCount: pageRangeLength(selectedPages),
        pageSpec: stringifyPageRange(selectedPages),
        batchSize: MAX_CONCURRENT_TRANSCRIPTIONS,
      },
    );

    for (const pageBatch of iterables.batch(iteratePages(selectedPages), MAX_CONCURRENT_TRANSCRIPTIONS)) {
      abortSignal?.throwIfAborted();

      const batchResults = await transcribePageBatch(pdfContext, pageBatch, transcriber, abortSignal);
      transcriptions.push(...batchResults);
    }
  } finally {
    await pdf.loadingTask.destroy();
  }

  logger.info('Finished PDF transcription for {source} ({pageCount} pages).', {
    source: sourceLabel,
    pageCount: transcriptions.length,
  });

  return transcriptions;
}

export async function transcribeImage(
  image: Uint8Array,
  transcriber: LanguageModel,
  abortSignal?: AbortSignal,
): Promise<PageTranscription> {
  abortSignal?.throwIfAborted();

  const startedAt = performance.now();

  logger.info('Transcribing page image ({byteLength} bytes).', { byteLength: image.byteLength });

  try {
    const result = await generateText({
      model: transcriber,
      instructions: TRANSCRIBER_SYSTEM_PROMPT,
      output: Output.object({ schema: pageTranscriptionSchema }),
      messages: [{ role: 'user', content: [{ type: 'image', image, mediaType: PNG_MEDIA_TYPE }] }],
      maxRetries: TRANSCRIBER_MAX_RETRIES,
      abortSignal,
    });

    abortSignal?.throwIfAborted();

    const transcription: PageTranscription = result.output;

    logger.info(
      'Transcribed page image in {elapsedMs}ms via {modelId} (markdownChars: {markdownChars}, hasNotes: {hasNotes}, usage: {usage}).',
      {
        elapsedMs: Math.round(performance.now() - startedAt),
        modelId: result.finalStep.response.modelId,
        markdownChars: transcription.transcribedMarkdown.length,
        hasNotes: transcription.notes !== undefined,
        usage: result.usage,
      },
    );

    if (transcription.notes !== undefined) {
      logger.info('Transcription notes: {notes}', { notes: transcription.notes });
    }

    return transcription;
  } catch (cause: unknown) {
    abortSignal?.throwIfAborted();
    throw new Error('Failed to transcribe page image', { cause });
  }
}

function readPdfBytes(pdfFile: VFile, sourceLabel: string): Uint8Array {
  if (!(pdfFile.value instanceof Uint8Array)) {
    throw new TypeError(`Expected binary PDF content in ${sourceLabel}`);
  }

  return new Uint8Array(pdfFile.value);
}

function resolvePageRange(
  requestedPages: MultiIntegerRange | undefined,
  totalPages: number,
  sourceLabel: string,
): MultiIntegerRange {
  if (requestedPages === undefined) {
    return totalPages > 0 ? [[1, totalPages]] : [];
  }

  const firstPage = minPage(requestedPages);
  const lastPage = maxPage(requestedPages);

  if (firstPage === undefined || lastPage === undefined) {
    return [];
  }

  if (firstPage < 1 || lastPage > totalPages) {
    throw new RangeError(
      `Requested pages (${stringifyPageRange(requestedPages)}) fall outside 1-${totalPages} for ${sourceLabel}`,
      {
        cause: {
          source: sourceLabel,
          pages: stringifyPageRange(requestedPages),
          totalPages,
        },
      },
    );
  }

  return requestedPages;
}

async function transcribePageBatch(
  pdfContext: PdfContext,
  pageNumbers: readonly number[],
  transcriber: LanguageModel,
  abortSignal?: AbortSignal,
): Promise<PageTranscription[]> {
  const { totalPages, sourceLabel } = pdfContext;
  const pageImages: Uint8Array[] = [];

  for (const pageNumber of pageNumbers) {
    abortSignal?.throwIfAborted();
    pageImages.push(await renderPdfPage(pdfContext, pageNumber));
  }

  logger.info('Dispatching transcription batch of {batchSize} pages ({pages}) for {source}.', {
    batchSize: pageNumbers.length,
    pages: pageNumbers.join(', '),
    source: sourceLabel,
  });

  // TODO: Cache all completed page work on a fatal error so retrying after a fix does not have to pay the cost again.
  const results = await Promise.all(
    pageImages.map((pageImage, index) => {
      const pageNumber = pageNumbers[index];

      return transcribeImage(pageImage, transcriber, abortSignal).then((transcription) => {
        logger.info('Completed page {pageNumber}/{totalPages} of {source}.', {
          pageNumber,
          totalPages,
          source: sourceLabel,
        });
        return transcription;
      });
    }),
  );

  logger.info('Completed transcription batch ({pages}) for {source}.', {
    pages: pageNumbers.join(', '),
    source: sourceLabel,
  });

  return results;
}

function renderPdfPage(pdfContext: PdfContext, pageNumber: number): Promise<Uint8Array> {
  const { pdf, totalPages, sourceLabel } = pdfContext;

  logger.info('Rendering page {pageNumber}/{totalPages} of {source} at scale {scale}.', {
    pageNumber,
    totalPages,
    source: sourceLabel,
    scale: PAGE_RENDER_SCALE,
  });

  return renderPageAsImage(pdf, pageNumber, {
    canvasImport: () => import('@napi-rs/canvas'),
    scale: PAGE_RENDER_SCALE,
  });
}
