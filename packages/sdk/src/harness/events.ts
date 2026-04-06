import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createLogger } from '@agntk/logger';

const log = createLogger('@agntk/core:harness-events');

export type AgentEventType = 'interaction' | 'decision' | 'error' | 'scheduled' | 'system';

export interface AgentEventOutcome {
  action: string;
  llmInvoked: boolean;
  tokensUsed: number;
}

export interface AgentEvent {
  id: string;
  source: string;
  type: AgentEventType;
  timestamp: string;
  threadId?: string;
  summary: string;
  details: unknown;
  outcome?: AgentEventOutcome;
}

export interface EventLogger {
  log(event: Omit<AgentEvent, 'id' | 'timestamp'>): void;
  getEvents(date: string): Promise<AgentEvent[]>;
  getEventsByThread(threadId: string): Promise<AgentEvent[]>;
  flush(): Promise<void>;
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function getEventFilePath(eventsDir: string, date: string): string {
  return join(eventsDir, `${date}.jsonl`);
}

export function createEventLogger(eventsDir: string): EventLogger {
  const buffer: AgentEvent[] = [];
  let flushPromise: Promise<void> | null = null;

  async function ensureDir(): Promise<void> {
    if (!existsSync(eventsDir)) {
      await mkdir(eventsDir, { recursive: true });
    }
  }

  async function flushBuffer(): Promise<void> {
    if (buffer.length === 0) return;

    const toFlush = buffer.splice(0, buffer.length);
    const grouped = new Map<string, AgentEvent[]>();

    for (const event of toFlush) {
      const date = event.timestamp.split('T')[0];
      const existing = grouped.get(date);
      if (existing) {
        existing.push(event);
      } else {
        grouped.set(date, [event]);
      }
    }

    await ensureDir();

    for (const [date, events] of grouped) {
      const filePath = getEventFilePath(eventsDir, date);
      const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
      try {
        await appendFile(filePath, lines, 'utf-8');
      } catch (err) {
        log.warn('Failed to write events', {
          path: filePath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return {
    log(partial: Omit<AgentEvent, 'id' | 'timestamp'>): void {
      const event: AgentEvent = {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        ...partial,
      };
      buffer.push(event);

      if (!flushPromise) {
        flushPromise = flushBuffer().finally(() => {
          flushPromise = null;
        });
      }
    },

    async getEvents(date: string): Promise<AgentEvent[]> {
      await this.flush();
      const filePath = getEventFilePath(eventsDir, date);

      if (!existsSync(filePath)) return [];

      try {
        const content = await readFile(filePath, 'utf-8');
        return content
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as AgentEvent);
      } catch (err) {
        log.warn('Failed to read events', {
          path: filePath,
          error: err instanceof Error ? err.message : String(err),
        });
        return [];
      }
    },

    async getEventsByThread(threadId: string): Promise<AgentEvent[]> {
      const today = formatDate(new Date());
      const events = await this.getEvents(today);
      return events.filter((e) => e.threadId === threadId);
    },

    async flush(): Promise<void> {
      if (flushPromise) await flushPromise;
      await flushBuffer();
    },
  };
}
