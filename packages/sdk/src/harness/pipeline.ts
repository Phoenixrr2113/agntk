import { createLogger } from '@agntk/logger';
import type { AgentEvent } from './events';
import type { EventLogger } from './events';
import type { Adapter } from './adapter';
import type { Gateway } from './gateway';

const log = createLogger('@agntk/core:harness-pipeline');

export type PipelineHandler = (event: AgentEvent) => void | Promise<void>;

export interface PipelineConfig {
  gateway: Gateway;
  eventLogger: EventLogger;
  onForward: PipelineHandler;
  batchIntervalMs?: number;
}

export interface Pipeline {
  attachAdapter(adapter: Adapter): void;
  detachAdapter(adapter: Adapter): void;
  process(event: AgentEvent): Promise<void>;
  flushBatch(): Promise<void>;
  shutdown(): Promise<void>;
}

export function createPipeline(config: PipelineConfig): Pipeline {
  const { gateway, eventLogger, onForward } = config;
  const batchInterval = config.batchIntervalMs ?? 30_000;
  const adapters = new Set<Adapter>();
  const batchQueue: AgentEvent[] = [];
  let batchTimer: ReturnType<typeof setInterval> | null = null;

  async function processBatch(): Promise<void> {
    if (batchQueue.length === 0) return;

    const events = batchQueue.splice(0, batchQueue.length);
    for (const event of events) {
      try {
        await onForward(event);
      } catch (err) {
        log.warn('Batch event forwarding failed', {
          eventId: event.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  function startBatchTimer(): void {
    if (batchTimer) return;
    batchTimer = setInterval(() => {
      processBatch().catch((err) => {
        log.warn('Batch processing failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, batchInterval);
  }

  const pipeline: Pipeline = {
    attachAdapter(adapter: Adapter): void {
      adapters.add(adapter);
      adapter.onEvent((event) => {
        pipeline.process(event).catch((err) => {
          log.warn('Pipeline process error from adapter', {
            adapter: adapter.name,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      });
      log.info('Adapter attached to pipeline', { name: adapter.name });
    },

    detachAdapter(adapter: Adapter): void {
      adapters.delete(adapter);
      log.info('Adapter detached from pipeline', { name: adapter.name });
    },

    async process(event: AgentEvent): Promise<void> {
      const result = gateway.evaluate(event);

      switch (result.action) {
        case 'drop':
          log.debug('Event dropped', { eventId: event.id, rule: result.matchedRule });
          break;

        case 'log':
          eventLogger.log({
            source: event.source,
            type: event.type,
            threadId: event.threadId,
            summary: event.summary,
            details: event.details,
            outcome: event.outcome,
          });
          break;

        case 'batch':
          batchQueue.push(event);
          startBatchTimer();
          break;

        case 'forward':
          eventLogger.log({
            source: event.source,
            type: event.type,
            threadId: event.threadId,
            summary: event.summary,
            details: event.details,
            outcome: event.outcome,
          });
          try {
            await onForward(event);
          } catch (err) {
            log.warn('Event forwarding failed', {
              eventId: event.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
          break;
      }
    },

    async flushBatch(): Promise<void> {
      await processBatch();
    },

    async shutdown(): Promise<void> {
      if (batchTimer) {
        clearInterval(batchTimer);
        batchTimer = null;
      }
      await processBatch();
      await eventLogger.flush();

      for (const adapter of adapters) {
        try {
          await adapter.disconnect();
        } catch (err) {
          log.warn('Adapter disconnect failed', {
            name: adapter.name,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      adapters.clear();

      log.info('Pipeline shut down');
    },
  };

  return pipeline;
}
