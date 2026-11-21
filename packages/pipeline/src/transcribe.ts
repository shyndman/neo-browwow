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

const logger = getLogger(['browwow', 'pipeline', 'transcribe']);

const TRANSCRIBER_SYSTEM_PROMPT = `
  Transcribe the following page image into Markdown format.

  * Use extended syntax for footnotes.
  * Tables, including those with colspans and rowspans are supported.
  * Omit headers and non-footnote footers.
  * Do not include any HTML. You are not attempting to recreate the PDF's layout in Markdown.
`;
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

    logger.info('Opened PDF {source} with {totalPages} pages; transcribing {selectedCount} ({pageSpec}).', {
      source: sourceLabel,
      totalPages,
      selectedCount: pageRangeLength(selectedPages),
      pageSpec: stringifyPageRange(selectedPages),
    });

    for (const pageNumber of iteratePages(selectedPages)) {
      abortSignal?.throwIfAborted();

      const pageImage = await renderPdfPage(pdf, pageNumber, totalPages, sourceLabel);
      const transcription = await transcribeImage(pageImage, transcriber, abortSignal);
      transcriptions.push(transcription);

      logger.info('Completed page {pageNumber}/{totalPages} of {source}.', {
        pageNumber,
        totalPages,
        source: sourceLabel,
      });
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

function renderPdfPage(
  pdf: Awaited<ReturnType<typeof getDocumentProxy>>,
  pageNumber: number,
  totalPages: number,
  sourceLabel: string,
): Promise<Uint8Array> {
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
