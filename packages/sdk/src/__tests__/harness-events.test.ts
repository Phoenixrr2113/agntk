import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createEventLogger } from '../harness/events';
import type { AgentEvent } from '../harness/events';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-events-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('EventLogger', () => {
  it('logs and retrieves events by date', async () => {
    const logger = createEventLogger(tmpDir);

    logger.log({
      source: 'test-agent',
      type: 'interaction',
      summary: 'User asked a question',
      details: { prompt: 'What is 2+2?' },
    });

    logger.log({
      source: 'test-agent',
      type: 'decision',
      summary: 'Chose to respond directly',
      details: { reasoning: 'Simple math' },
    });

    await logger.flush();

    const today = new Date().toISOString().split('T')[0];
    const events = await logger.getEvents(today);

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('interaction');
    expect(events[0].summary).toBe('User asked a question');
    expect(events[0].id).toBeDefined();
    expect(events[0].timestamp).toBeDefined();
    expect(events[1].type).toBe('decision');
  });

  it('stores events as JSONL files', async () => {
    const logger = createEventLogger(tmpDir);

    logger.log({
      source: 'test',
      type: 'system',
      summary: 'Test event',
      details: null,
    });

    await logger.flush();

    const today = new Date().toISOString().split('T')[0];
    const filePath = path.join(tmpDir, `${today}.jsonl`);
    expect(fs.existsSync(filePath)).toBe(true);

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]) as AgentEvent;
    expect(parsed.summary).toBe('Test event');
  });

  it('filters events by threadId', async () => {
    const logger = createEventLogger(tmpDir);

    logger.log({
      source: 'test',
      type: 'interaction',
      threadId: 'thread-1',
      summary: 'Event in thread 1',
      details: null,
    });

    logger.log({
      source: 'test',
      type: 'interaction',
      threadId: 'thread-2',
      summary: 'Event in thread 2',
      details: null,
    });

    logger.log({
      source: 'test',
      type: 'interaction',
      threadId: 'thread-1',
      summary: 'Another event in thread 1',
      details: null,
    });

    await logger.flush();

    const thread1Events = await logger.getEventsByThread('thread-1');
    expect(thread1Events).toHaveLength(2);
    expect(thread1Events[0].summary).toBe('Event in thread 1');
    expect(thread1Events[1].summary).toBe('Another event in thread 1');
  });

  it('returns empty array for date with no events', async () => {
    const logger = createEventLogger(tmpDir);
    const events = await logger.getEvents('2020-01-01');
    expect(events).toEqual([]);
  });

  it('includes outcome when provided', async () => {
    const logger = createEventLogger(tmpDir);

    logger.log({
      source: 'test',
      type: 'interaction',
      summary: 'Answered question',
      details: null,
      outcome: { action: 'respond', llmInvoked: true, tokensUsed: 150 },
    });

    await logger.flush();

    const today = new Date().toISOString().split('T')[0];
    const events = await logger.getEvents(today);

    expect(events[0].outcome).toEqual({
      action: 'respond',
      llmInvoked: true,
      tokensUsed: 150,
    });
  });

  it('creates events directory if it does not exist', async () => {
    const nestedDir = path.join(tmpDir, 'nested', 'events');
    const logger = createEventLogger(nestedDir);

    logger.log({
      source: 'test',
      type: 'system',
      summary: 'Init',
      details: null,
    });

    await logger.flush();

    expect(fs.existsSync(nestedDir)).toBe(true);
  });
});
