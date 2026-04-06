import { describe, it, expect, vi } from 'vitest';
import { BaseAdapter } from '../harness/adapter';
import type { AgentEvent } from '../harness/events';

class TestAdapter extends BaseAdapter {
  readonly name = 'test-adapter';

  async simulateEvent(event: AgentEvent): Promise<void> {
    this.emit(event);
  }
}

function makeEvent(summary: string): AgentEvent {
  return {
    id: 'test-id',
    source: 'test',
    type: 'interaction',
    timestamp: new Date().toISOString(),
    summary,
    details: null,
  };
}

describe('BaseAdapter', () => {
  it('connects and disconnects', async () => {
    const adapter = new TestAdapter();

    expect(adapter.isConnected()).toBe(false);
    await adapter.connect();
    expect(adapter.isConnected()).toBe(true);
    await adapter.disconnect();
    expect(adapter.isConnected()).toBe(false);
  });

  it('emits events to registered handlers', async () => {
    const adapter = new TestAdapter();
    const handler = vi.fn();

    adapter.onEvent(handler);
    await adapter.connect();

    const event = makeEvent('Test event');
    await adapter.simulateEvent(event);

    expect(handler).toHaveBeenCalledWith(event);
  });

  it('supports multiple handlers', async () => {
    const adapter = new TestAdapter();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    adapter.onEvent(handler1);
    adapter.onEvent(handler2);

    const event = makeEvent('Multi handler test');
    await adapter.simulateEvent(event);

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
  });

  it('clears handlers on disconnect', async () => {
    const adapter = new TestAdapter();
    const handler = vi.fn();

    adapter.onEvent(handler);
    await adapter.connect();
    await adapter.disconnect();

    const event = makeEvent('Should not fire');
    await adapter.simulateEvent(event);

    expect(handler).not.toHaveBeenCalled();
  });

  it('handles errors in event handlers gracefully', async () => {
    const adapter = new TestAdapter();
    const errorHandler = vi.fn(() => {
      throw new Error('handler error');
    });
    const goodHandler = vi.fn();

    adapter.onEvent(errorHandler);
    adapter.onEvent(goodHandler);

    const event = makeEvent('Error test');
    await adapter.simulateEvent(event);

    expect(errorHandler).toHaveBeenCalled();
    expect(goodHandler).toHaveBeenCalled();
  });
});
