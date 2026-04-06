/**
 * @agntk/client - ChatClient Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatClient } from '../chat-client';
import { AgentHttpClient } from '../http-client';
import type { StreamEvent } from '../types';

vi.mock('../http-client');

describe('ChatClient', () => {
  let chatClient: ChatClient;
  let mockHttpClient: AgentHttpClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttpClient = new AgentHttpClient('http://localhost:3000');
    chatClient = new ChatClient(mockHttpClient);
  });

  describe('stream', () => {
    it('should dispatch text-delta events to onTextDelta callback', async () => {
      const events: StreamEvent[] = [
        { type: 'text-delta', textDelta: 'Hello' },
        { type: 'text-delta', textDelta: ' World' },
        {
          type: 'finish',
          text: 'Hello World',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      ];

      vi.mocked(mockHttpClient.generateStream).mockImplementation(async function* () {
        for (const event of events) {
          yield event;
        }
      });

      const textChunks: string[] = [];
      let completeResult: { text: string } | undefined;

      await chatClient.stream(
        { messages: [{ role: 'user', content: 'Hi' }] },
        {
          onTextDelta: (text) => textChunks.push(text),
          onComplete: (result) => {
            completeResult = result;
          },
        },
      );

      expect(textChunks).toEqual(['Hello', ' World']);
      expect(completeResult?.text).toBe('Hello World');
    });

    it('should dispatch tool-call events', async () => {
      const events: StreamEvent[] = [
        { type: 'tool-call', toolCallId: 'tc_1', toolName: 'search', args: { query: 'test' } },
        { type: 'tool-result', toolCallId: 'tc_1', toolName: 'search', result: { found: true } },
        { type: 'finish', text: 'Done' },
      ];

      vi.mocked(mockHttpClient.generateStream).mockImplementation(async function* () {
        for (const event of events) {
          yield event;
        }
      });

      const toolCalls: Array<{ id: string; name: string; args: unknown }> = [];
      const toolResults: Array<{ id: string; name: string; result: unknown }> = [];

      await chatClient.stream(
        { messages: [{ role: 'user', content: 'Search' }] },
        {
          onToolCall: (id, name, args) => toolCalls.push({ id, name, args }),
          onToolResult: (id, name, result) => toolResults.push({ id, name, result }),
        },
      );

      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]).toEqual({ id: 'tc_1', name: 'search', args: { query: 'test' } });
      expect(toolResults).toHaveLength(1);
      expect(toolResults[0]).toEqual({ id: 'tc_1', name: 'search', result: { found: true } });
    });

    it('should dispatch step events', async () => {
      const events: StreamEvent[] = [
        { type: 'step-start', stepIndex: 0 },
        { type: 'text-delta', textDelta: 'Step 1 output' },
        { type: 'step-finish', stepIndex: 0, finishReason: 'stop' },
        { type: 'finish', text: 'Done' },
      ];

      vi.mocked(mockHttpClient.generateStream).mockImplementation(async function* () {
        for (const event of events) {
          yield event;
        }
      });

      const stepStarts: number[] = [];
      const stepFinishes: Array<{ index: number; reason: string }> = [];

      await chatClient.stream(
        { messages: [{ role: 'user', content: 'Run steps' }] },
        {
          onStepStart: (index) => stepStarts.push(index),
          onStepFinish: (index, reason) => stepFinishes.push({ index, reason }),
        },
      );

      expect(stepStarts).toEqual([0]);
      expect(stepFinishes).toEqual([{ index: 0, reason: 'stop' }]);
    });

    it('should dispatch error events', async () => {
      const events: StreamEvent[] = [{ type: 'error', error: 'Something went wrong' }];

      vi.mocked(mockHttpClient.generateStream).mockImplementation(async function* () {
        for (const event of events) {
          yield event;
        }
      });

      const errors: string[] = [];

      await chatClient.stream(
        { messages: [{ role: 'user', content: 'Fail' }] },
        {
          onError: (error) => errors.push(error),
        },
      );

      expect(errors).toEqual(['Something went wrong']);
    });

    it('should call onError when generator throws', async () => {
      vi.mocked(mockHttpClient.generateStream).mockImplementation(async function* () {
        yield* [];
        throw new Error('Network error');
      });

      const errors: string[] = [];

      await chatClient.stream(
        { messages: [{ role: 'user', content: 'Hi' }] },
        {
          onError: (error) => errors.push(error),
        },
      );

      expect(errors).toEqual(['Network error']);
    });
  });
});
