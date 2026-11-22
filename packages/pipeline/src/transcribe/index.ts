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
<role>
Transcribe the provided English document page image into clean GitHub Flavored Markdown (GFM).
</role>

<critical>
- Emit pure Markdown only. NEVER emit HTML.
- Transcribe semantic content and structure; NEVER try to recreate the PDF's visual layout, spacing, or line breaks.
- Never interrupt a sentence or paragraph with an out-of-flow element.
- If the page has no transcribable content, set \`transcribedMarkdown\` to \`""\`, \`continuesPreviousPage\` to \`false\`, and explain briefly in \`notes\` (e.g., "Blank page"). Never emit placeholder text such as \`[Blank page]\`.
</critical>

<directives>
## Layout and Reading Order
- Follow logical prose order: top-to-bottom within each column, left-to-right across columns.
- Omit page chrome: running headers, running footers, page numbers, margin line numbers, and watermarks or margin stamps.
- Defer every out-of-flow element (tables, sidebars, callouts, pull quotes, algorithm boxes, citation blocks, etc.) until the current sentence or paragraph finishes, placing it at the nearest paragraph boundary.
- Format sidebars and callouts as Markdown blockquotes (\`>\`).

## Markdown Extensions and Conventions
- **Headings**: Use Markdown headings (\`#\`–\`######\`) reflecting the page's visible hierarchy rather than bold text.
- **Math**: Use \`$...$\` for inline math within prose and \`$$...$$\` for standalone display equations.
- **Footnotes**: Use GFM footnotes (\`[^id]\` and \`[^id]: ...\`). Preserve the page's printed footnote markers (e.g., \`[^4]\`), normalizing non-alphanumeric symbols such as \`*\` or \`†\` to valid identifiers (e.g., \`[^star]\`, \`[^dagger]\`). Collect all footnote definitions at the bottom of the page.
- **Extended tables**: Colspan and rowspan are supported using \`>\` (merge rightwards into the cell to the right, where the merged text lives) and \`^\` (merge upwards into the cell above).
</directives>

<example name="extended-table">
| > | Metric | Value |
| --- | --- | --- |
| Latency | p50 | 12ms |
| ^ | p99 | 45ms |
</example>

<output>
- \`transcribedMarkdown\`: The page's Markdown content, or \`""\` if the page has no transcribable content.
- \`continuesPreviousPage\`: \`true\` if the page's opening content continues an unfinished element from the previous page; otherwise \`false\`.
- \`notes\`: Optional brief note for transcription issues, or a brief explanation when \`transcribedMarkdown\` is \`""\`.
</output>

<critical>
No HTML, no visual layout mimicry, no mid-sentence interruptions, and no placeholder text for empty pages.
</critical>
`.trim();
const MAX_CONCURRENT_TRANSCRIPTIONS = 5;
const TRANSCRIBER_MAX_RETRIES = 5;
const PAGE_RENDER_SCALE = 2;
const PNG_MEDIA_TYPE = 'image/png';

// Single-sided continuation avoids cross-page disagreement; keeping the envelope flat
// ensures even empty pages must return a structured object (distinguishing blank pages
// from silent refusals via `notes`).
const pageTranscriptionSchema = z.object({
  transcribedMarkdown: z.string(),
  continuesPreviousPage: z
    .boolean()
    .describe('True when the page opens by continuing an unfinished element from the previous page.'),
  notes: z
    .string()
    .optional()
    .describe(
      'Any issues noticed while transcribing the page, or a brief reason when transcribedMarkdown is empty.',
    ),
});

export interface PageTranscription {
  readonly transcribedMarkdown: string;
  readonly continuesPreviousPage: boolean;
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
      'Transcribed page image in {elapsedMs}ms via {modelId} (markdownChars: {markdownChars}, continuesPreviousPage: {continuesPreviousPage}, hasNotes: {hasNotes}, usage: {usage}).',
      {
        elapsedMs: Math.round(performance.now() - startedAt),
        modelId: result.finalStep.response.modelId,
        markdownChars: transcription.transcribedMarkdown.length,
        continuesPreviousPage: transcription.continuesPreviousPage,
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
