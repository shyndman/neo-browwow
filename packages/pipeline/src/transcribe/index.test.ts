import { describe, expect, test } from 'bun:test';

import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { parse as parsePageRange } from 'multi-integer-range';
import { VFile } from 'vfile';

import { type PageTranscription, transcribeFile, transcribeImage } from './index';

const PNG_MAGIC_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_WIDTH_OFFSET = 16;
const PNG_HEIGHT_OFFSET = 20;
const EXPECTED_RENDERED_PAGE_SIZE_PX = 216;
const EXPECTED_TRANSCRIBER_TEMPERATURE = 0.4;
const EXPECTED_MAX_CONCURRENT_TRANSCRIPTIONS = 3;

const MOCK_USAGE = {
  inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 25, text: 25, reasoning: 0 },
} as const;

function createMockTranscriptionModel(responses: readonly PageTranscription[]): MockLanguageModelV4 {
  let callIndex = 0;

  return new MockLanguageModelV4({
    modelId: 'vision-test',
    doGenerate: () => {
      const payload = responses[callIndex];
      callIndex += 1;

      return Promise.resolve({
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: MOCK_USAGE,
        warnings: [],
      });
    },
  });
}

function buildMinimalPdf(pageCount: number): Uint8Array {
  const objects: string[] = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    `2 0 obj\n<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, i) => `${i + 3} 0 R`).join(' ')}] /Count ${pageCount} >>\nendobj\n`,
  ];

  for (let i = 0; i < pageCount; i += 1) {
    objects.push(`${i + 3} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] >>\nendobj\n`);
  }

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];

  for (const object of objects) {
    offsets.push(body.length);
    body += object;
  }

  const xrefOffset = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;

  for (const offset of offsets) {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }

  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return new TextEncoder().encode(body);
}

describe('transcribeImage', () => {
  test('calls the model with the transcription system prompt, PNG image input, and structured output schema', async () => {
    const sampleImage = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02]);
    const model = createMockTranscriptionModel([
      { transcribedMarkdown: '# Page 1\n\nHello world.', notes: 'Slight skew on top margin.' },
    ]);

    const result = await transcribeImage(sampleImage, model);

    expect(result).toEqual({
      transcribedMarkdown: '# Page 1\n\nHello world.',
      notes: 'Slight skew on top margin.',
    });
    expect(model.doGenerateCalls).toHaveLength(1);

    const call = model.doGenerateCalls[0];

    expect(call.responseFormat?.type).toBe('json');
    expect(call.temperature).toBe(EXPECTED_TRANSCRIBER_TEMPERATURE);
    expect(call.prompt[0]?.role).toBe('system');
    if (call.prompt[0]?.role === 'system') {
      expect(call.prompt[0].content).toContain('Transcribe the following page image into Markdown format.');
    }

    expect(call.prompt[1]).toEqual({
      role: 'user',
      content: [
        {
          type: 'file',
          data: { type: 'data', data: sampleImage },
          mediaType: 'image/png',
        },
      ],
    });
  });

  test('supports structured output without optional notes', async () => {
    const model = createMockTranscriptionModel([{ transcribedMarkdown: 'Plain paragraph.' }]);
    const result = await transcribeImage(new Uint8Array([1, 2, 3]), model);

    expect(result).toEqual({ transcribedMarkdown: 'Plain paragraph.' });
    expect(result.notes).toBeUndefined();
  });

  test('propagates abort signals before and after the model call', async () => {
    const preAbortReason = new Error('Pre-aborted');
    const preAborted = new AbortController();
    preAborted.abort(preAbortReason);

    const uncalledModel = createMockTranscriptionModel([{ transcribedMarkdown: 'unused' }]);
    let preAbortError: unknown;
    try {
      await transcribeImage(new Uint8Array([1]), uncalledModel, preAborted.signal);
    } catch (error: unknown) {
      preAbortError = error;
    }

    expect(preAbortError).toBe(preAbortReason);
    expect(uncalledModel.doGenerateCalls).toHaveLength(0);

    const midFlightReason = new Error('Aborted mid-flight');
    const midFlightController = new AbortController();
    const midFlightModel = new MockLanguageModelV4({
      modelId: 'vision-test',
      doGenerate: () => {
        midFlightController.abort(midFlightReason);
        return Promise.resolve({
          content: [{ type: 'text', text: JSON.stringify({ transcribedMarkdown: 'partial' }) }],
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: MOCK_USAGE,
          warnings: [],
        });
      },
    });

    let midFlightError: unknown;
    try {
      await transcribeImage(new Uint8Array([1]), midFlightModel, midFlightController.signal);
    } catch (error: unknown) {
      midFlightError = error;
    }

    expect(midFlightError).toBe(midFlightReason);
  });

  test('wraps model failures in an Error with cause', async () => {
    const upstreamFailure = new APICallError({
      message: 'Unauthorized',
      url: 'https://llama.don.haus/v1/chat/completions',
      requestBodyValues: {},
      statusCode: 401,
      isRetryable: false,
    });
    const failingModel = new MockLanguageModelV4({
      modelId: 'vision-test',
      doGenerate: () => Promise.reject(upstreamFailure),
    });

    let caughtError: unknown;
    try {
      await transcribeImage(new Uint8Array([1]), failingModel);
    } catch (error: unknown) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(Error);
    if (caughtError instanceof Error) {
      expect(caughtError.message).toBe('Failed to transcribe page image');
      expect(caughtError.cause).toBe(upstreamFailure);
    }
  });
});

function expectPngImageCall(call: MockLanguageModelV4['doGenerateCalls'][number]): void {
  const userMessage = call.prompt[1];

  expect(userMessage?.role).toBe('user');
  if (userMessage?.role !== 'user') {
    return;
  }

  const part = userMessage.content[0];

  expect(part?.type).toBe('file');
  if (part?.type !== 'file') {
    return;
  }

  expect(part.mediaType).toBe('image/png');
  expect(part.data.type).toBe('data');
  if (part.data.type !== 'data') {
    return;
  }

  expect(part.data.data).toBeInstanceOf(Uint8Array);
  if (part.data.data instanceof Uint8Array) {
    const pngBytes = part.data.data;
    const pngHeader = new DataView(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength);

    expect(Array.from(pngBytes.slice(0, PNG_MAGIC_BYTES.length))).toEqual(PNG_MAGIC_BYTES);
    expect(pngHeader.getUint32(PNG_WIDTH_OFFSET)).toBe(EXPECTED_RENDERED_PAGE_SIZE_PX);
    expect(pngHeader.getUint32(PNG_HEIGHT_OFFSET)).toBe(EXPECTED_RENDERED_PAGE_SIZE_PX);
  }
}

describe('transcribeFile', () => {
  test('renders each PDF page to a PNG image and transcribes pages in order', async () => {
    const pdfFile = new VFile({
      path: 'sample.pdf',
      value: buildMinimalPdf(2),
    });
    const model = createMockTranscriptionModel([
      { transcribedMarkdown: '# First Page' },
      { transcribedMarkdown: '# Second Page', notes: 'Footer cropped.' },
    ]);

    const results = await transcribeFile(pdfFile, model);

    expect(results).toEqual([
      { transcribedMarkdown: '# First Page' },
      { transcribedMarkdown: '# Second Page', notes: 'Footer cropped.' },
    ]);
    expect(model.doGenerateCalls).toHaveLength(2);

    for (const call of model.doGenerateCalls) {
      expectPngImageCall(call);
    }
  });

  test('transcribes only the requested page ranges when pages option is provided', async () => {
    const pdfFile = new VFile({
      path: 'multi.pdf',
      value: buildMinimalPdf(8),
    });
    const model = createMockTranscriptionModel([
      { transcribedMarkdown: 'Page 1' },
      { transcribedMarkdown: 'Page 2' },
      { transcribedMarkdown: 'Page 3' },
      { transcribedMarkdown: 'Page 6' },
      { transcribedMarkdown: 'Page 7' },
      { transcribedMarkdown: 'Page 8' },
    ]);

    const results = await transcribeFile(pdfFile, model, {
      pages: parsePageRange('1,2,3,6-8'),
    });

    expect(results).toEqual([
      { transcribedMarkdown: 'Page 1' },
      { transcribedMarkdown: 'Page 2' },
      { transcribedMarkdown: 'Page 3' },
      { transcribedMarkdown: 'Page 6' },
      { transcribedMarkdown: 'Page 7' },
      { transcribedMarkdown: 'Page 8' },
    ]);
    expect(model.doGenerateCalls).toHaveLength(6);
  });

  test('throws RangeError when requested pages fall outside the document bounds', async () => {
    const pdfFile = new VFile({
      path: 'short.pdf',
      value: buildMinimalPdf(3),
    });
    const model = createMockTranscriptionModel([]);

    let outOfUpperBoundError: unknown;

    try {
      await transcribeFile(pdfFile, model, { pages: parsePageRange('1-4') });
    } catch (error: unknown) {
      outOfUpperBoundError = error;
    }

    expect(outOfUpperBoundError).toBeInstanceOf(RangeError);
    if (outOfUpperBoundError instanceof RangeError) {
      expect(outOfUpperBoundError.message).toContain('1-4');
      expect(outOfUpperBoundError.message).toContain('1-3');
    }

    let outOfLowerBoundError: unknown;

    try {
      await transcribeFile(pdfFile, model, { pages: [[0, 1]] });
    } catch (error: unknown) {
      outOfLowerBoundError = error;
    }

    expect(outOfLowerBoundError).toBeInstanceOf(RangeError);
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  test('dispatches transcription requests in concurrent batches of 3 and preserves page order', async () => {
    const pdfFile = new VFile({
      path: 'batched.pdf',
      value: buildMinimalPdf(7),
    });

    interface PendingCall {
      readonly pageNumber: number;
      readonly resolve: () => void;
    }

    const pendingCalls: PendingCall[] = [];
    let nextPageNumber = 1;
    let inFlight = 0;
    let maxInFlight = 0;

    const model = new MockLanguageModelV4({
      modelId: 'vision-test',
      doGenerate: () => {
        const pageNumber = nextPageNumber;
        nextPageNumber += 1;
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);

        return new Promise((resolve) => {
          pendingCalls.push({
            pageNumber,
            resolve: () => {
              inFlight -= 1;
              resolve({
                content: [
                  { type: 'text', text: JSON.stringify({ transcribedMarkdown: `Page ${pageNumber}` }) },
                ],
                finishReason: { unified: 'stop', raw: 'stop' },
                usage: MOCK_USAGE,
                warnings: [],
              });
            },
          });
        });
      },
    });

    const waitForPendingCount = async (expectedCount: number): Promise<void> => {
      for (let attempt = 0; attempt < 200 && pendingCalls.length < expectedCount; attempt += 1) {
        await Bun.sleep(5);
      }
    };

    const transcriptionPromise = transcribeFile(pdfFile, model);

    await waitForPendingCount(EXPECTED_MAX_CONCURRENT_TRANSCRIPTIONS);
    expect(pendingCalls.map((call) => call.pageNumber)).toEqual([1, 2, 3]);
    expect(inFlight).toBe(EXPECTED_MAX_CONCURRENT_TRANSCRIPTIONS);

    const firstBatch = pendingCalls.splice(0, EXPECTED_MAX_CONCURRENT_TRANSCRIPTIONS).toReversed();
    for (const call of firstBatch) {
      call.resolve();
    }

    await waitForPendingCount(EXPECTED_MAX_CONCURRENT_TRANSCRIPTIONS);
    expect(pendingCalls.map((call) => call.pageNumber)).toEqual([4, 5, 6]);
    expect(inFlight).toBe(EXPECTED_MAX_CONCURRENT_TRANSCRIPTIONS);

    const secondBatch = pendingCalls.splice(0, EXPECTED_MAX_CONCURRENT_TRANSCRIPTIONS).toReversed();
    for (const call of secondBatch) {
      call.resolve();
    }

    await waitForPendingCount(1);
    expect(pendingCalls.map((call) => call.pageNumber)).toEqual([7]);
    expect(inFlight).toBe(1);

    const thirdBatch = pendingCalls.splice(0, 1).toReversed();
    for (const call of thirdBatch) {
      call.resolve();
    }

    const results = await transcriptionPromise;

    expect(maxInFlight).toBe(EXPECTED_MAX_CONCURRENT_TRANSCRIPTIONS);
    expect(results).toEqual([
      { transcribedMarkdown: 'Page 1' },
      { transcribedMarkdown: 'Page 2' },
      { transcribedMarkdown: 'Page 3' },
      { transcribedMarkdown: 'Page 4' },
      { transcribedMarkdown: 'Page 5' },
      { transcribedMarkdown: 'Page 6' },
      { transcribedMarkdown: 'Page 7' },
    ]);
  });

  test('dispatches transcription requests in concurrent batches of 3 and preserves page order', async () => {
    const pdfFile = new VFile({
      path: 'batched.pdf',
      value: buildMinimalPdf(7),
    });

    interface PendingCall {
      readonly pageNumber: number;
      readonly resolve: () => void;
    }

    const pendingCalls: PendingCall[] = [];
    let nextPageNumber = 1;
    let inFlight = 0;
    let maxInFlight = 0;

    const model = new MockLanguageModelV4({
      modelId: 'vision-test',
      doGenerate: () => {
        const pageNumber = nextPageNumber;
        nextPageNumber += 1;
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);

        return new Promise((resolve) => {
          pendingCalls.push({
            pageNumber,
            resolve: () => {
              inFlight -= 1;
              resolve({
                content: [
                  { type: 'text', text: JSON.stringify({ transcribedMarkdown: `Page ${pageNumber}` }) },
                ],
                finishReason: { unified: 'stop', raw: 'stop' },
                usage: MOCK_USAGE,
                warnings: [],
              });
            },
          });
        });
      },
    });

    const waitForPendingCount = async (expectedCount: number): Promise<void> => {
      for (let attempt = 0; attempt < 200 && pendingCalls.length < expectedCount; attempt += 1) {
        await Bun.sleep(5);
      }
    };

    const transcriptionPromise = transcribeFile(pdfFile, model);

    await waitForPendingCount(EXPECTED_MAX_CONCURRENT_TRANSCRIPTIONS);
    expect(pendingCalls.map((call) => call.pageNumber)).toEqual([1, 2, 3]);
    expect(inFlight).toBe(EXPECTED_MAX_CONCURRENT_TRANSCRIPTIONS);

    const firstBatch = pendingCalls.splice(0, EXPECTED_MAX_CONCURRENT_TRANSCRIPTIONS).toReversed();
    for (const call of firstBatch) {
      call.resolve();
    }

    await waitForPendingCount(EXPECTED_MAX_CONCURRENT_TRANSCRIPTIONS);
    expect(pendingCalls.map((call) => call.pageNumber)).toEqual([4, 5, 6]);
    expect(inFlight).toBe(EXPECTED_MAX_CONCURRENT_TRANSCRIPTIONS);

    const secondBatch = pendingCalls.splice(0, EXPECTED_MAX_CONCURRENT_TRANSCRIPTIONS).toReversed();
    for (const call of secondBatch) {
      call.resolve();
    }

    await waitForPendingCount(1);
    expect(pendingCalls.map((call) => call.pageNumber)).toEqual([7]);
    expect(inFlight).toBe(1);

    const thirdBatch = pendingCalls.splice(0, 1).toReversed();
    for (const call of thirdBatch) {
      call.resolve();
    }

    const results = await transcriptionPromise;

    expect(maxInFlight).toBe(EXPECTED_MAX_CONCURRENT_TRANSCRIPTIONS);
    expect(results).toEqual([
      { transcribedMarkdown: 'Page 1' },
      { transcribedMarkdown: 'Page 2' },
      { transcribedMarkdown: 'Page 3' },
      { transcribedMarkdown: 'Page 4' },
      { transcribedMarkdown: 'Page 5' },
      { transcribedMarkdown: 'Page 6' },
      { transcribedMarkdown: 'Page 7' },
    ]);
  });

  test('rejects non-binary VFile inputs', async () => {
    const textFile = new VFile({ path: 'not-a-pdf.txt', value: 'hello' });
    const model = createMockTranscriptionModel([]);

    let caughtError: unknown;

    try {
      await transcribeFile(textFile, model);
    } catch (error: unknown) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(TypeError);
    if (caughtError instanceof Error) {
      expect(caughtError.message).toBe('Expected binary PDF content in not-a-pdf.txt');
    }
    expect(model.doGenerateCalls).toHaveLength(0);
  });
});
