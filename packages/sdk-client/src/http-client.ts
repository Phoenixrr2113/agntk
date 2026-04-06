// HTTP client for agent server

import { createLogger } from '@agntk/logger';
import { ApiClientError } from './errors';
import type {
  ChatRequest,
  ChatResponse,
  SessionResponse,
  HistoryResponse,
  StreamEvent,
  GenerateStreamOptions,
  StreamMetadata,
} from './types';

const log = createLogger('@agntk/client');

export class AgentHttpClient {
  constructor(private baseUrl: string) {
    log.debug('Created HTTP client', { baseUrl });
  }

  async generate(request: ChatRequest): Promise<ChatResponse> {
    log.debug('generate', { messageCount: request.messages?.length });
    const response = await fetch(`${this.baseUrl}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      log.error('generate failed', { status: response.status });
      throw new ApiClientError('Generate failed', response.status);
    }
    return response.json();
  }

  /**
   * Stream a generation request using Server-Sent Events.
   * Returns an AsyncGenerator that yields StreamEvents.
   *
   * Supports resumable streams: when the server is a durable agent,
   * the response includes `x-workflow-run-id`. Use `options.workflowRunId`
   * and `options.lastEventId` to reconnect and replay.
   * @param request - Chat request with messages
   * @param options - Streaming options (signal for abort, reconnection)
   * @yields StreamEvent - Stream events with metadata property
   * @example
   * ```typescript
   * const controller = new AbortController();
   * const gen = client.generateStream(request, { signal: controller.signal });
   *
   * for await (const event of gen) {
   *   if (event.type === 'text-delta') {
   *     process.stdout.write(event.textDelta);
   *   }
   * }
   *
   * // After disconnect, reconnect:
   * const metadata = gen.metadata;
   * const resumed = client.generateStream(request, {
   *   workflowRunId: metadata?.workflowRunId,
   *   lastEventId: metadata?.lastEventId,
   * });
   * ```
   */
  async *generateStream(
    request: ChatRequest,
    options: GenerateStreamOptions = {},
  ): AsyncGenerator<StreamEvent> & { metadata?: StreamMetadata } {
    log.debug('generateStream', {
      messageCount: request.messages?.length,
      workflowRunId: options.workflowRunId,
      lastEventId: options.lastEventId,
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    };

    // Add resumable stream headers
    if (options.workflowRunId) {
      headers['x-workflow-run-id'] = options.workflowRunId;
    }
    if (options.lastEventId) {
      headers['Last-Event-ID'] = options.lastEventId;
    }

    const response = await fetch(`${this.baseUrl}/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal: options.signal,
    });

    if (!response.ok) {
      log.error('generateStream failed', { status: response.status });
      throw new ApiClientError('Generate stream failed', response.status);
    }

    if (!response.body) {
      throw new ApiClientError('No response body for stream', 500);
    }

    // Capture workflow run ID from response headers
    const workflowRunId = response.headers.get('x-workflow-run-id') ?? undefined;
    let lastEventId: string | undefined;

    // Attach metadata to the generator (accessible after iteration)
    const metadata: StreamMetadata = { workflowRunId, lastEventId };
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const generator = this;
    (generator as { _lastStreamMetadata?: StreamMetadata })._lastStreamMetadata = metadata;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEventId: string | undefined;

        for (const line of lines) {
          // Track SSE event IDs for resumability
          if (line.startsWith('id: ')) {
            currentEventId = line.slice(4).trim();
            lastEventId = currentEventId;
            metadata.lastEventId = lastEventId;
            continue;
          }

          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (!data || data === '[DONE]') continue;

          try {
            const event = JSON.parse(data) as StreamEvent;
            log.trace('Stream event', { type: event.type, eventId: currentEventId });
            yield event;
          } catch (e: unknown) {
            log.warn('Failed to parse SSE data', { data, error: e });
          }
        }
      }

      // Handle any remaining buffer
      if (buffer.startsWith('data: ')) {
        const data = buffer.slice(6).trim();
        if (data && data !== '[DONE]') {
          try {
            yield JSON.parse(data) as StreamEvent;
          } catch {
            // Ignore parse errors on final chunk
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Get metadata from the last stream (workflow run ID, last event ID).
   * Useful for implementing reconnection.
   */
  get lastStreamMetadata(): StreamMetadata | undefined {
    return (this as { _lastStreamMetadata?: StreamMetadata })._lastStreamMetadata;
  }

  async getSession(sessionId: string): Promise<SessionResponse> {
    log.debug('getSession', { sessionId });
    const response = await fetch(`${this.baseUrl}/sessions/${sessionId}`);
    if (!response.ok) {
      throw new ApiClientError('Session not found', response.status);
    }
    return response.json();
  }

  async getHistory(sessionId: string): Promise<HistoryResponse> {
    log.debug('getHistory', { sessionId });
    const response = await fetch(`${this.baseUrl}/sessions/${sessionId}/history`);
    if (!response.ok) {
      throw new ApiClientError('History not found', response.status);
    }
    return response.json();
  }
}
