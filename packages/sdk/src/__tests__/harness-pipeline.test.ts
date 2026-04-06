import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createGateway } from '../harness/gateway';
import { createPipeline } from '../harness/pipeline';
import { createEventLogger } from '../harness/events';
import { BaseAdapter } from '../harness/adapter';
import type { AgentEvent } from '../harness/events';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeEvent(type: AgentEvent['type'], summary: string): AgentEvent {
  return {
    id: `evt-${Date.now()}`,
    source: 'test',
    type,
    timestamp: new Date().toISOString(),
    summary,
    details: null,
  };
}

class MockAdapter extends BaseAdapter {
  readonly name = 'mock-adapter';

  async fireEvent(event: AgentEvent): Promise<void> {
    this.emit(event);
  }
}

describe('Gateway', () => {
  it('applies first matching rule', () => {
    const gateway = createGateway();

    gateway.addRule({
      name: 'drop-errors',
      match: (e) => e.type === 'error',
      action: 'drop',
    });

    const errorEvent = makeEvent('error', 'Something failed');
    const result = gateway.evaluate(errorEvent);

    expect(result.action).toBe('drop');
    expect(result.matchedRule).toBe('drop-errors');
  });

  it('returns default action when no rules match', () => {
    const gateway = createGateway('log');

    const event = makeEvent('interaction', 'Normal event');
    const result = gateway.evaluate(event);

    expect(result.action).toBe('log');
    expect(result.matchedRule).toBeNull();
  });
});

describe('Pipeline', () => {
  it('forwards events through gateway to handler', async () => {
    const eventLogger = createEventLogger(path.join(tmpDir, 'events'));
    const gateway = createGateway('forward');
    const forwardHandler = vi.fn();

    const pipeline = createPipeline({
      gateway,
      eventLogger,
      onForward: forwardHandler,
    });

    const event = makeEvent('interaction', 'User query');
    await pipeline.process(event);

    expect(forwardHandler).toHaveBeenCalledWith(event);

    await pipeline.shutdown();
  });

  it('drops events when gateway rule says drop', async () => {
    const eventLogger = createEventLogger(path.join(tmpDir, 'events'));
    const gateway = createGateway();
    const forwardHandler = vi.fn();

    gateway.addRule({
      name: 'drop-system',
      match: (e) => e.type === 'system',
      action: 'drop',
    });

    const pipeline = createPipeline({
      gateway,
      eventLogger,
      onForward: forwardHandler,
    });

    const event = makeEvent('system', 'Internal event');
    await pipeline.process(event);

    expect(forwardHandler).not.toHaveBeenCalled();

    await pipeline.shutdown();
  });

  it('receives events from attached adapters', async () => {
    const eventLogger = createEventLogger(path.join(tmpDir, 'events'));
    const gateway = createGateway('forward');
    const forwardHandler = vi.fn();

    const pipeline = createPipeline({
      gateway,
      eventLogger,
      onForward: forwardHandler,
    });

    const adapter = new MockAdapter();
    pipeline.attachAdapter(adapter);

    const event = makeEvent('interaction', 'From adapter');
    await adapter.fireEvent(event);

    await new Promise((r) => setTimeout(r, 50));

    expect(forwardHandler).toHaveBeenCalled();

    await pipeline.shutdown();
  });

  it('batches events and flushes them', async () => {
    const eventLogger = createEventLogger(path.join(tmpDir, 'events'));
    const gateway = createGateway();
    const forwardHandler = vi.fn();

    gateway.addRule({
      name: 'batch-scheduled',
      match: (e) => e.type === 'scheduled',
      action: 'batch',
    });

    const pipeline = createPipeline({
      gateway,
      eventLogger,
      onForward: forwardHandler,
      batchIntervalMs: 100_000,
    });

    const event1 = makeEvent('scheduled', 'Scheduled 1');
    const event2 = makeEvent('scheduled', 'Scheduled 2');

    await pipeline.process(event1);
    await pipeline.process(event2);

    expect(forwardHandler).not.toHaveBeenCalled();

    await pipeline.flushBatch();

    expect(forwardHandler).toHaveBeenCalledTimes(2);

    await pipeline.shutdown();
  });
});
