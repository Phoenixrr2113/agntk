/**
 * @agntk/client - Resumable Streams Tests
 *
 * Tests for the client-side resumable stream feature (SDK-STREAMS-007).
 * Verifies reconnect logic, metadata capture, and exponential backoff.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatClient } from '../chat-client';
import { AgentHttpClient } from '../http-client';
import type { StreamEvent, StreamMetadata } from '../types';

vi.mock('../http-client');

describe('ChatClient - Resumable Streams', () => {
  let chatClient: ChatClient;
  let mockHttpClient: AgentHttpClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttpClient = new AgentHttpClient('http://localhost:3000');
    chatClient = new ChatClient(mockHttpClient, {
      reconnect: {
        enabled: true,
        maxAttempts: 3,
        baseDelayMs: 10,
        maxDelayMs: 100,
      },
    });
  });

  describe('metadata capture', () => {
    it('should capture stream metadata after successful stream', async () => {
      const events: StreamEvent[] = [
        { type: 'text-delta', textDelta: 'Hello' },
        { type: 'finish', text: 'Hello' },
      ];

      vi.mocked(mockHttpClient.generateStream).mockImplementation(async function* () {
        for (const event of events) {
          yield event;
        }
      });

      Object.defineProperty(mockHttpClient, 'lastStreamMetadata', {
        get: () => ({ workflowRunId: 'wf-123', lastEventId: 'wf-123:1' }) as StreamMetadata,
        configurable: true,
      });

      await chatClient.stream(
        { messages: [{ role: 'user', content: 'Hi' }] },
        { onTextDelta: () => {} },
      );

      expect(chatClient.lastStreamMetadata?.workflowRunId).toBe('wf-123');
      expect(chatClient.lastStreamMetadata?.lastEventId).toBe('wf-123:1');
    });
  });

  describe('auto-reconnect', () => {
    it('should reconnect on disconnect when workflow run-id exists', async () => {
      let callCount = 0;

      vi.mocked(mockHttpClient.generateStream).mockImplementation(async function* () {
        callCount++;
        if (callCount === 1) {
          // First call: emit some events then throw (simulating disconnect)
          yield { type: 'text-delta', textDelta: 'Hel' } as StreamEvent;
          throw new Error('Connection lost');
        }
        // Second call: complete the stream
        yield { type: 'text-delta', textDelta: 'lo' } as StreamEvent;
        yield { type: 'finish', text: 'Hello' } as StreamEvent;
      });

      // Make metadata available with a workflowRunId
      Object.defineProperty(mockHttpClient, 'lastStreamMetadata', {
        get: () =>
          ({ workflowRunId: 'wf-reconnect', lastEventId: 'wf-reconnect:0' }) as StreamMetadata,
        configurable: true,
      });

      const textChunks: string[] = [];
      const reconnects: Array<{ attempt: number; runId: string }> = [];

      await chatClient.stream(
        { messages: [{ role: 'user', content: 'Hi' }] },
        {
          onTextDelta: (text) => textChunks.push(text),
          onReconnect: (attempt, runId) => reconnects.push({ attempt, runId }),
        },
      );

      expect(callCount).toBe(2);
      expect(textChunks).toEqual(['Hel', 'lo']);
      expect(reconnects).toHaveLength(1);
      expect(reconnects[0].attempt).toBe(1);
      expect(reconnects[0].runId).toBe('wf-reconnect');
    });

    it('should NOT reconnect when no workflow run-id is available', async () => {
      vi.mocked(mockHttpClient.generateStream).mockImplementation(async function* () {
        yield { type: 'text-delta', textDelta: 'Hi' } as StreamEvent;
        throw new Error('Connection lost');
      });

      // No workflow metadata
      Object.defineProperty(mockHttpClient, 'lastStreamMetadata', {
        get: () => undefined,
        configurable: true,
      });

      const errors: string[] = [];

      await chatClient.stream(
        { messages: [{ role: 'user', content: 'Hi' }] },
        {
          onError: (error) => errors.push(error),
        },
      );

      expect(errors).toEqual(['Connection lost']);
      // Should only have been called once (no reconnect)
      expect(vi.mocked(mockHttpClient.generateStream)).toHaveBeenCalledTimes(1);
    });

    it('should stop reconnecting after max attempts', async () => {
      let callCount = 0;

      vi.mocked(mockHttpClient.generateStream).mockImplementation(async function* () {
        callCount++;
        yield* [];
        throw new Error(`Failure ${callCount}`);
      });

      Object.defineProperty(mockHttpClient, 'lastStreamMetadata', {
        get: () => ({ workflowRunId: 'wf-fail', lastEventId: undefined }) as StreamMetadata,
        configurable: true,
      });

      const errors: string[] = [];
      const reconnects: number[] = [];

      await chatClient.stream(
        { messages: [{ role: 'user', content: 'Hi' }] },
        {
          onError: (error) => errors.push(error),
          onReconnect: (attempt) => reconnects.push(attempt),
        },
      );

      // Max attempts is 3, so we should see 3 reconnect calls + 1 final error
      expect(reconnects).toEqual([1, 2, 3]);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Failure');
    });

    it('should NOT reconnect on abort signal', async () => {
      vi.mocked(mockHttpClient.generateStream).mockImplementation(async function* () {
        yield* [];
        const error = new DOMException('The operation was aborted', 'AbortError');
        throw error;
      });

      Object.defineProperty(mockHttpClient, 'lastStreamMetadata', {
        get: () => ({ workflowRunId: 'wf-abort', lastEventId: undefined }) as StreamMetadata,
        configurable: true,
      });

      const errors: string[] = [];

      await chatClient.stream(
        { messages: [{ role: 'user', content: 'Hi' }] },
        {
          onError: (error) => errors.push(error),
        },
      );

      // Should not reconnect on abort
      expect(vi.mocked(mockHttpClient.generateStream)).toHaveBeenCalledTimes(1);
      expect(errors).toEqual(['The operation was aborted']);
    });

    it('should pass workflowRunId and lastEventId on reconnect', async () => {
      let callCount = 0;

      vi.mocked(mockHttpClient.generateStream).mockImplementation(async function* (_req, _opts) {
        callCount++;
        if (callCount === 1) {
          throw new Error('disconnect');
        }
        yield { type: 'finish', text: 'done' } as StreamEvent;
      });

      Object.defineProperty(mockHttpClient, 'lastStreamMetadata', {
        get: () =>
          ({
            workflowRunId: 'wf-pass-headers',
            lastEventId: 'wf-pass-headers:5',
          }) as StreamMetadata,
        configurable: true,
      });

      await chatClient.stream(
        { messages: [{ role: 'user', content: 'Hi' }] },
        {
          onReconnect: () => {},
        },
      );

      // Verify the second call includes the reconnection options
      const secondCallOptions = vi.mocked(mockHttpClient.generateStream).mock.calls[1][1];
      expect(secondCallOptions?.workflowRunId).toBe('wf-pass-headers');
      expect(secondCallOptions?.lastEventId).toBe('wf-pass-headers:5');
    });
  });

  describe('disabled reconnect', () => {
    it('should not reconnect when reconnect is disabled', async () => {
      const noReconnectClient = new ChatClient(mockHttpClient, {
        reconnect: { enabled: false },
      });

      vi.mocked(mockHttpClient.generateStream).mockImplementation(async function* () {
        yield* [];
        throw new Error('disconnect');
      });

      Object.defineProperty(mockHttpClient, 'lastStreamMetadata', {
        get: () => ({ workflowRunId: 'wf-disabled', lastEventId: undefined }) as StreamMetadata,
        configurable: true,
      });

      const errors: string[] = [];

      await noReconnectClient.stream(
        { messages: [{ role: 'user', content: 'Hi' }] },
        {
          onError: (error) => errors.push(error),
        },
      );

      expect(vi.mocked(mockHttpClient.generateStream)).toHaveBeenCalledTimes(1);
      expect(errors).toEqual(['disconnect']);
    });
  });
});
