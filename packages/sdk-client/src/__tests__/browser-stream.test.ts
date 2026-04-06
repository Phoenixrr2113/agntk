/**
 * @fileoverview Tests for BrowserStreamClient.
 * Tests connection lifecycle, frame handling, input injection, and reconnection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrowserStreamClient } from '../browser-stream';
import type { BrowserFrame } from '../browser-stream';

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  sentMessages: string[] = [];

  constructor(public url: string) {
    // Simulate connection in next tick
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.(new Event('open'));
    }, 0);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new Event('close'));
  }

  // Test helper: simulate receiving a message
  simulateMessage(data: Record<string, unknown>) {
    const event = { data: JSON.stringify(data) } as MessageEvent;
    this.onmessage?.(event);
  }

  // Test helper: simulate error
  simulateError() {
    this.onerror?.(new Event('error'));
  }
}

// Store last created instance for test access
let lastMockWs: MockWebSocket | null = null;

const MockWebSocketSubclass = class extends MockWebSocket {
  constructor(url: string) {
    super(url);
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    lastMockWs = this;
  }
  static override OPEN = 1;
};
vi.stubGlobal('WebSocket', MockWebSocketSubclass);

describe('BrowserStreamClient', () => {
  let client: BrowserStreamClient;

  beforeEach(() => {
    vi.useFakeTimers();
    lastMockWs = null;
  });

  afterEach(() => {
    client?.disconnect();
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create with default options', () => {
      client = new BrowserStreamClient({ url: 'ws://localhost:3000/ws/browser-stream' });
      expect(client.getState()).toBe('disconnected');
    });
  });

  describe('connection', () => {
    it('should connect to WebSocket endpoint', async () => {
      client = new BrowserStreamClient({ url: 'ws://localhost:3000/ws/browser-stream' });

      const connectPromise = client.connect();
      await vi.runAllTimersAsync();
      await connectPromise;

      expect(client.getState()).toBe('connected');
    });

    it('should call onStateChange callback', async () => {
      client = new BrowserStreamClient({ url: 'ws://localhost:3000/ws/browser-stream' });
      const stateChanges: string[] = [];

      const connectPromise = client.connect({
        onStateChange: (state) => stateChanges.push(state),
      });

      await vi.runAllTimersAsync();
      await connectPromise;

      expect(stateChanges).toContain('connecting');
      expect(stateChanges).toContain('connected');
    });

    it('should disconnect cleanly', async () => {
      client = new BrowserStreamClient({ url: 'ws://localhost:3000/ws/browser-stream' });

      const connectPromise = client.connect();
      await vi.runAllTimersAsync();
      await connectPromise;

      client.disconnect();
      expect(client.getState()).toBe('disconnected');
    });
  });

  describe('frame handling', () => {
    it('should dispatch frame events to callback', async () => {
      client = new BrowserStreamClient({ url: 'ws://localhost:3000/ws/browser-stream' });
      const frames: BrowserFrame[] = [];

      const connectPromise = client.connect({
        onFrame: (frame) => frames.push(frame),
      });

      await vi.runAllTimersAsync();
      await connectPromise;

      // Simulate receiving a frame
      lastMockWs?.simulateMessage({
        type: 'frame',
        data: 'base64data==',
        timestamp: 1000,
        sequence: 0,
      });

      expect(frames).toHaveLength(1);
      expect(frames[0]).toEqual({
        data: 'base64data==',
        timestamp: 1000,
        sequence: 0,
      });
    });

    it('should transition to streaming state on first frame', async () => {
      client = new BrowserStreamClient({ url: 'ws://localhost:3000/ws/browser-stream' });

      const connectPromise = client.connect();
      await vi.runAllTimersAsync();
      await connectPromise;

      expect(client.getState()).toBe('connected');

      lastMockWs?.simulateMessage({
        type: 'frame',
        data: 'data',
        timestamp: 1000,
        sequence: 0,
      });

      expect(client.getState()).toBe('streaming');
    });

    it('should track frame statistics', async () => {
      client = new BrowserStreamClient({ url: 'ws://localhost:3000/ws/browser-stream' });

      const connectPromise = client.connect();
      await vi.runAllTimersAsync();
      await connectPromise;

      lastMockWs?.simulateMessage({ type: 'frame', data: 'a', timestamp: 100, sequence: 0 });
      lastMockWs?.simulateMessage({ type: 'frame', data: 'b', timestamp: 200, sequence: 1 });

      const stats = client.getStats();
      expect(stats.frameCount).toBe(2);
    });
  });

  describe('event dispatching', () => {
    it('should dispatch started event', async () => {
      client = new BrowserStreamClient({ url: 'ws://localhost:3000/ws/browser-stream' });
      const startedSpy = vi.fn();

      const connectPromise = client.connect({ onStarted: startedSpy });
      await vi.runAllTimersAsync();
      await connectPromise;

      lastMockWs?.simulateMessage({ type: 'started', config: { fps: 3 } });
      expect(startedSpy).toHaveBeenCalledWith({ fps: 3 });
    });

    it('should dispatch stopped event', async () => {
      client = new BrowserStreamClient({ url: 'ws://localhost:3000/ws/browser-stream' });
      const stoppedSpy = vi.fn();

      const connectPromise = client.connect({ onStopped: stoppedSpy });
      await vi.runAllTimersAsync();
      await connectPromise;

      // Set to streaming first
      lastMockWs?.simulateMessage({ type: 'frame', data: 'a', timestamp: 100, sequence: 0 });
      lastMockWs?.simulateMessage({ type: 'stopped' });

      expect(stoppedSpy).toHaveBeenCalled();
      expect(client.getState()).toBe('connected');
    });

    it('should dispatch error events', async () => {
      client = new BrowserStreamClient({ url: 'ws://localhost:3000/ws/browser-stream' });
      const errorSpy = vi.fn();

      const connectPromise = client.connect({ onError: errorSpy });
      await vi.runAllTimersAsync();
      await connectPromise;

      lastMockWs?.simulateMessage({ type: 'error', error: 'Browser crashed' });
      expect(errorSpy).toHaveBeenCalledWith('Browser crashed');
    });

    it('should dispatch input-ack events', async () => {
      client = new BrowserStreamClient({ url: 'ws://localhost:3000/ws/browser-stream' });
      const ackSpy = vi.fn();

      const connectPromise = client.connect({ onInputAck: ackSpy });
      await vi.runAllTimersAsync();
      await connectPromise;

      lastMockWs?.simulateMessage({ type: 'input-ack', inputType: 'click', success: true });
      expect(ackSpy).toHaveBeenCalledWith('click', true, undefined);
    });

    it('should dispatch config-ack events', async () => {
      client = new BrowserStreamClient({ url: 'ws://localhost:3000/ws/browser-stream' });
      const configAckSpy = vi.fn();

      const connectPromise = client.connect({ onConfigAck: configAckSpy });
      await vi.runAllTimersAsync();
      await connectPromise;

      lastMockWs?.simulateMessage({
        type: 'config-ack',
        config: { fps: 5, quality: 80, width: 1920, height: 1080 },
      });
      expect(configAckSpy).toHaveBeenCalledWith({
        fps: 5,
        quality: 80,
        width: 1920,
        height: 1080,
      });
    });
  });

  describe('input injection', () => {
    beforeEach(async () => {
      client = new BrowserStreamClient({ url: 'ws://localhost:3000/ws/browser-stream' });
      const p = client.connect();
      await vi.runAllTimersAsync();
      await p;
    });

    it('should send click events', () => {
      client.click(100, 200);
      const sent = JSON.parse(lastMockWs!.sentMessages[0]);
      expect(sent).toEqual({ type: 'click', x: 100, y: 200 });
    });

    it('should send type events', () => {
      client.type('hello', '#input');
      const sent = JSON.parse(lastMockWs!.sentMessages[0]);
      expect(sent).toEqual({ type: 'type', text: 'hello', selector: '#input' });
    });

    it('should send press events', () => {
      client.press('Enter');
      const sent = JSON.parse(lastMockWs!.sentMessages[0]);
      expect(sent).toEqual({ type: 'press', key: 'Enter' });
    });

    it('should send scroll events', () => {
      client.scroll('down', 300);
      const sent = JSON.parse(lastMockWs!.sentMessages[0]);
      expect(sent).toEqual({ type: 'scroll', direction: 'down', pixels: 300 });
    });

    it('should send fill events', () => {
      client.fill('#search', 'test query');
      const sent = JSON.parse(lastMockWs!.sentMessages[0]);
      expect(sent).toEqual({ type: 'fill', selector: '#search', text: 'test query' });
    });
  });

  describe('stream control', () => {
    beforeEach(async () => {
      client = new BrowserStreamClient({ url: 'ws://localhost:3000/ws/browser-stream' });
      const p = client.connect();
      await vi.runAllTimersAsync();
      await p;
    });

    it('should send config update', () => {
      client.setConfig({ fps: 5, quality: 90 });
      const sent = JSON.parse(lastMockWs!.sentMessages[0]);
      expect(sent).toEqual({ type: 'config', fps: 5, quality: 90 });
    });

    it('should send pause command', () => {
      client.pause();
      const sent = JSON.parse(lastMockWs!.sentMessages[0]);
      expect(sent).toEqual({ type: 'stop' });
    });

    it('should send resume command', () => {
      client.resume();
      const sent = JSON.parse(lastMockWs!.sentMessages[0]);
      expect(sent).toEqual({ type: 'start' });
    });
  });

  describe('callback registration', () => {
    it('should support onFrame callback', async () => {
      client = new BrowserStreamClient({ url: 'ws://localhost:3000/ws/browser-stream' });
      const frameSpy = vi.fn();
      client.onFrame(frameSpy);

      const p = client.connect();
      await vi.runAllTimersAsync();
      await p;

      lastMockWs?.simulateMessage({ type: 'frame', data: 'test', timestamp: 0, sequence: 0 });
      expect(frameSpy).toHaveBeenCalled();
    });

    it('should support onError callback', async () => {
      client = new BrowserStreamClient({ url: 'ws://localhost:3000/ws/browser-stream' });
      const errorSpy = vi.fn();
      client.onError(errorSpy);

      const p = client.connect();
      await vi.runAllTimersAsync();
      await p;

      lastMockWs?.simulateMessage({ type: 'error', error: 'test error' });
      expect(errorSpy).toHaveBeenCalledWith('test error');
    });

    it('should support onStateChange callback', async () => {
      client = new BrowserStreamClient({ url: 'ws://localhost:3000/ws/browser-stream' });
      const stateChangeSpy = vi.fn();
      client.onStateChange(stateChangeSpy);

      const p = client.connect();
      await vi.runAllTimersAsync();
      await p;

      expect(stateChangeSpy).toHaveBeenCalled();
    });
  });
});
