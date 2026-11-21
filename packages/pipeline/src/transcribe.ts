import { getLogger } from '@logtape/logtape';
import { type LanguageModel, Output, generateText } from 'ai';
import { getDocumentProxy, renderPageAsImage } from 'unpdf';
import type { VFile } from 'vfile';
import { z } from 'zod';

const logger = getLogger(['browwow', 'pipeline', 'transcribe']);

const TRANSCRIPTION_SYSTEM_PROMPT = '';
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

export async function transcribeFile(
  pdfFile: VFile,
  model: LanguageModel,
  abortSignal?: AbortSignal,
): Promise<PageTranscription[]> {
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

    logger.info('Opened PDF {source} with {totalPages} pages.', { source: sourceLabel, totalPages });

    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      abortSignal?.throwIfAborted();

      const pageImage = await renderPdfPage(pdf, pageNumber, totalPages, sourceLabel);
      const transcription = await transcribeImage(pageImage, model, abortSignal);
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
  model: LanguageModel,
  abortSignal?: AbortSignal,
): Promise<PageTranscription> {
  abortSignal?.throwIfAborted();

  const startedAt = performance.now();

  logger.info('Transcribing page image ({byteLength} bytes).', { byteLength: image.byteLength });

  try {
    const result = await generateText({
      model,
      instructions: TRANSCRIPTION_SYSTEM_PROMPT,
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
