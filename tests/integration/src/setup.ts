import { MockLanguageModelV3, mockValues } from 'ai/test';
import { simulateReadableStream } from 'ai';
import type { LanguageModel } from 'ai';

export function createMockModel(text: string): LanguageModel {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text', text }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 20, text: 20, reasoning: undefined },
      },
      warnings: [],
    }),
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-start', id: 'text-1' },
          { type: 'text-delta' as const, id: 'text-1', delta: text },
          { type: 'text-end', id: 'text-1' },
          {
            type: 'finish',
            finishReason: { unified: 'stop', raw: undefined },
            logprobs: undefined,
            usage: {
              inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
              outputTokens: { total: 20, text: 20, reasoning: undefined },
            },
          },
        ],
      }),
    }),
  }) as unknown as LanguageModel;
}

export function createMockMultiModel(texts: string[]): LanguageModel {
  const values = mockValues(
    ...texts.map((text) => ({
      content: [{ type: 'text' as const, text }],
      finishReason: { unified: 'stop' as const, raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 20, text: 20, reasoning: undefined },
      },
      warnings: [],
    })),
  );

  let streamIndex = 0;

  return new MockLanguageModelV3({
    doGenerate: async () => values(),
    doStream: async () => {
      const text = texts[streamIndex % texts.length];
      streamIndex++;
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start', id: 'text-1' },
            { type: 'text-delta' as const, id: 'text-1', delta: text },
            { type: 'text-end', id: 'text-1' },
            {
              type: 'finish',
              finishReason: { unified: 'stop', raw: undefined },
              logprobs: undefined,
              usage: {
                inputTokens: {
                  total: 10,
                  noCache: 10,
                  cacheRead: undefined,
                  cacheWrite: undefined,
                },
                outputTokens: { total: 20, text: 20, reasoning: undefined },
              },
            },
          ],
        }),
      };
    },
  }) as unknown as LanguageModel;
}

export function createMockStreamModel(text: string): LanguageModel {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-start', id: 'text-1' },
          ...text.split(' ').map((word, i) => ({
            type: 'text-delta' as const,
            id: 'text-1',
            delta: (i > 0 ? ' ' : '') + word,
          })),
          { type: 'text-end', id: 'text-1' },
          {
            type: 'finish',
            finishReason: { unified: 'stop', raw: undefined },
            logprobs: undefined,
            usage: {
              inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
              outputTokens: { total: 20, text: 20, reasoning: undefined },
            },
          },
        ],
      }),
    }),
  }) as unknown as LanguageModel;
}

export function createMockToolModel(
  toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>,
  finalText: string,
): LanguageModel {
  let generateCount = 0;
  let streamCount = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => {
      generateCount++;
      if (generateCount === 1) {
        return {
          content: toolCalls.map((tc) => ({
            type: 'tool-call' as const,
            toolCallId: tc.id,
            toolName: tc.name,
            args: JSON.stringify(tc.args),
          })),
          finishReason: { unified: 'tool-calls', raw: undefined },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 20, text: 20, reasoning: undefined },
          },
          warnings: [],
        };
      }
      return {
        content: [{ type: 'text', text: finalText }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 20, text: 20, reasoning: undefined },
        },
        warnings: [],
      };
    },
    doStream: async () => {
      streamCount++;
      if (streamCount === 1) {
        const chunks: Array<Record<string, unknown>> = toolCalls.map((tc) => ({
          type: 'tool-call' as const,
          toolCallId: tc.id,
          toolName: tc.name,
          args: JSON.stringify(tc.args),
        }));
        chunks.push({
          type: 'finish',
          finishReason: { unified: 'tool-calls', raw: undefined },
          logprobs: undefined,
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 20, text: 20, reasoning: undefined },
          },
        });
        return { stream: simulateReadableStream({ chunks }) };
      }

      return {
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start', id: 'text-1' },
            { type: 'text-delta' as const, id: 'text-1', delta: finalText },
            { type: 'text-end', id: 'text-1' },
            {
              type: 'finish',
              finishReason: { unified: 'stop', raw: undefined },
              logprobs: undefined,
              usage: {
                inputTokens: {
                  total: 10,
                  noCache: 10,
                  cacheRead: undefined,
                  cacheWrite: undefined,
                },
                outputTokens: { total: 20, text: 20, reasoning: undefined },
              },
            },
          ],
        }),
      };
    },
  }) as unknown as LanguageModel;
}

export function createMockMultiStepToolModel(
  toolCallsPerStep: Array<Array<{ id: string; name: string; args: Record<string, unknown> }>>,
  finalText: string,
): LanguageModel {
  let generateCount = 0;
  let streamCount = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => {
      const step = toolCallsPerStep[generateCount];
      generateCount++;
      if (step) {
        return {
          content: step.map((tc) => ({
            type: 'tool-call' as const,
            toolCallId: tc.id,
            toolName: tc.name,
            args: JSON.stringify(tc.args),
          })),
          finishReason: { unified: 'tool-calls', raw: undefined },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 20, text: 20, reasoning: undefined },
          },
          warnings: [],
        };
      }
      return {
        content: [{ type: 'text', text: finalText }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 20, text: 20, reasoning: undefined },
        },
        warnings: [],
      };
    },
    doStream: async () => {
      const step = toolCallsPerStep[streamCount];
      streamCount++;
      if (step) {
        const chunks: Array<Record<string, unknown>> = step.map((tc) => ({
          type: 'tool-call' as const,
          toolCallId: tc.id,
          toolName: tc.name,
          args: JSON.stringify(tc.args),
        }));
        chunks.push({
          type: 'finish',
          finishReason: { unified: 'tool-calls', raw: undefined },
          logprobs: undefined,
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 20, text: 20, reasoning: undefined },
          },
        });
        return { stream: simulateReadableStream({ chunks }) };
      }
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start', id: 'text-1' },
            { type: 'text-delta' as const, id: 'text-1', delta: finalText },
            { type: 'text-end', id: 'text-1' },
            {
              type: 'finish',
              finishReason: { unified: 'stop', raw: undefined },
              logprobs: undefined,
              usage: {
                inputTokens: {
                  total: 10,
                  noCache: 10,
                  cacheRead: undefined,
                  cacheWrite: undefined,
                },
                outputTokens: { total: 20, text: 20, reasoning: undefined },
              },
            },
          ],
        }),
      };
    },
  }) as unknown as LanguageModel;
}

export function createMockModelWithSpy(text: string): {
  model: LanguageModel;
  calls: Array<{ prompt: unknown }>;
} {
  const calls: Array<{ prompt: unknown }> = [];
  const model = new MockLanguageModelV3({
    doGenerate: async (params) => {
      calls.push({ prompt: params.prompt });
      return {
        content: [{ type: 'text', text }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 20, text: 20, reasoning: undefined },
        },
        warnings: [],
      };
    },
    doStream: async (params) => {
      calls.push({ prompt: params.prompt });
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start', id: 'text-1' },
            { type: 'text-delta' as const, id: 'text-1', delta: text },
            { type: 'text-end', id: 'text-1' },
            {
              type: 'finish',
              finishReason: { unified: 'stop', raw: undefined },
              logprobs: undefined,
              usage: {
                inputTokens: {
                  total: 10,
                  noCache: 10,
                  cacheRead: undefined,
                  cacheWrite: undefined,
                },
                outputTokens: { total: 20, text: 20, reasoning: undefined },
              },
            },
          ],
        }),
      };
    },
  }) as unknown as LanguageModel;
  return { model, calls };
}
