/**
 * @fileoverview Browser stream client for real-time viewport streaming.
 * Connects to the /ws/browser-stream WebSocket endpoint and provides
 * a typed API for receiving frames and injecting user input.
 */

import { createLogger } from '@agntk/logger';

const log = createLogger('@agntk/client:browser-stream');

// ============================================================================
// Types
// ============================================================================

export interface BrowserStreamClientOptions {
  /** WebSocket URL (e.g., ws://localhost:3000/ws/browser-stream) */
  url: string;
  /** Auto-reconnect on disconnect (default: true) */
  reconnect?: boolean;
  /** Max reconnect attempts (default: 5) */
  maxReconnectAttempts?: number;
  /** Base delay between reconnect attempts in ms (default: 1000) */
  reconnectDelay?: number;
}

export interface BrowserFrame {
  /** Base64-encoded image data */
  data: string;
  /** Capture timestamp (ms since epoch) */
  timestamp: number;
  /** Frame sequence number */
  sequence: number;
}

export interface BrowserStreamConfig {
  fps?: number;
  quality?: number;
  width?: number;
  height?: number;
}

export type BrowserStreamState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'streaming'
  | 'reconnecting';

export interface BrowserStreamCallbacks {
  /** Called for each viewport frame */
  onFrame?: (frame: BrowserFrame) => void;
  /** Called when the stream starts */
  onStarted?: (config: BrowserStreamConfig) => void;
  /** Called when the stream stops */
  onStopped?: () => void;
  /** Called on stream error */
  onError?: (error: string) => void;
  /** Called when connection state changes */
  onStateChange?: (state: BrowserStreamState) => void;
  /** Called when input injection is acknowledged */
  onInputAck?: (inputType: string, success: boolean, error?: string) => void;
  /** Called when config change is acknowledged */
  onConfigAck?: (config: BrowserStreamConfig) => void;
}

// Incoming message types from server
type ServerMessage =
  | { type: 'frame'; data: string; timestamp: number; sequence: number }
  | { type: 'started'; config: BrowserStreamConfig }
  | { type: 'stopped' }
  | { type: 'error'; error: string }
  | { type: 'input-ack'; inputType: string; success: boolean; error?: string }
  | { type: 'config-ack'; config: BrowserStreamConfig };

// ============================================================================
// BrowserStreamClient
// ============================================================================

export class BrowserStreamClient {
  private ws: WebSocket | null = null;
  private options: Required<BrowserStreamClientOptions>;
  private state: BrowserStreamState = 'disconnected';
  private callbacks: BrowserStreamCallbacks = {};
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private frameCount = 0;
  private lastFrameTime = 0;

  constructor(options: BrowserStreamClientOptions) {
    this.options = {
      reconnect: true,
      maxReconnectAttempts: 5,
      reconnectDelay: 1000,
      ...options,
    };
    log.debug('Created BrowserStreamClient', { url: options.url });
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Connect to the browser stream WebSocket endpoint.
   */
  connect(callbacks?: BrowserStreamCallbacks): Promise<void> {
    if (callbacks) this.callbacks = callbacks;
    if (this.state === 'connected' || this.state === 'streaming') {
      return Promise.resolve();
    }

    this.setState('connecting');

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.options.url);

        this.ws.onopen = () => {
          log.info('Browser stream connected');
          this.setState('connected');
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event);
        };

        this.ws.onclose = () => {
          log.info('Browser stream disconnected');
          if (this.state !== 'disconnected') {
            this.handleReconnect();
          }
        };

        this.ws.onerror = (error) => {
          log.error('Browser stream connection error', { error });
          if (this.state === 'connecting') {
            this.setState('disconnected');
            reject(new Error('Failed to connect to browser stream'));
          }
        };
      } catch {
        this.setState('disconnected');
        reject(new Error('Failed to create WebSocket connection'));
      }
    });
  }

  /**
   * Disconnect from the browser stream.
   */
  disconnect(): void {
    log.debug('Disconnecting browser stream');
    this.setState('disconnected');
    this.clearReconnectTimer();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Get current connection state.
   */
  getState(): BrowserStreamState {
    return this.state;
  }

  /**
   * Get frame statistics.
   */
  getStats(): { frameCount: number; lastFrameTime: number; fps: number } {
    const elapsed = (Date.now() - this.lastFrameTime) / 1000;
    return {
      frameCount: this.frameCount,
      lastFrameTime: this.lastFrameTime,
      fps: elapsed > 0 ? 1 / elapsed : 0,
    };
  }

  // --------------------------------------------------------------------------
  // Input Injection
  // --------------------------------------------------------------------------

  /**
   * Inject a click at viewport coordinates.
   */
  click(x: number, y: number): void {
    this.send({ type: 'click', x, y });
  }

  /**
   * Inject text typing. Optionally target a specific element.
   */
  type(text: string, selector?: string): void {
    this.send({ type: 'type', text, selector });
  }

  /**
   * Inject a key press.
   */
  press(key: string): void {
    this.send({ type: 'press', key });
  }

  /**
   * Inject a scroll event.
   */
  scroll(direction: 'up' | 'down' | 'left' | 'right', pixels?: number): void {
    this.send({ type: 'scroll', direction, pixels });
  }

  /**
   * Fill an input element.
   */
  fill(selector: string, text: string): void {
    this.send({ type: 'fill', selector, text });
  }

  // --------------------------------------------------------------------------
  // Stream Control
  // --------------------------------------------------------------------------

  /**
   * Update stream configuration (FPS, quality, resolution).
   */
  setConfig(config: BrowserStreamConfig): void {
    this.send({ type: 'config', ...config });
  }

  /**
   * Pause the stream (stop frame capture).
   */
  pause(): void {
    this.send({ type: 'stop' });
  }

  /**
   * Resume the stream (restart frame capture).
   */
  resume(): void {
    this.send({ type: 'start' });
  }

  // --------------------------------------------------------------------------
  // Callbacks
  // --------------------------------------------------------------------------

  /**
   * Register a frame callback.
   */
  onFrame(callback: (frame: BrowserFrame) => void): void {
    this.callbacks.onFrame = callback;
  }

  /**
   * Register an error callback.
   */
  onError(callback: (error: string) => void): void {
    this.callbacks.onError = callback;
  }

  /**
   * Register a state change callback.
   */
  onStateChange(callback: (state: BrowserStreamState) => void): void {
    this.callbacks.onStateChange = callback;
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  private setState(newState: BrowserStreamState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.callbacks.onStateChange?.(newState);
      log.debug('State changed', { state: newState });
    }
  }

  private send(data: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      log.warn('Cannot send: WebSocket not connected');
      return;
    }
    this.ws.send(JSON.stringify(data));
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const msg = JSON.parse(event.data as string) as ServerMessage;

      switch (msg.type) {
        case 'frame':
          this.frameCount++;
          this.lastFrameTime = Date.now();
          if (this.state !== 'streaming') {
            this.setState('streaming');
          }
          this.callbacks.onFrame?.({
            data: msg.data,
            timestamp: msg.timestamp,
            sequence: msg.sequence,
          });
          break;

        case 'started':
          this.callbacks.onStarted?.(msg.config);
          break;

        case 'stopped':
          if (this.state === 'streaming') {
            this.setState('connected');
          }
          this.callbacks.onStopped?.();
          break;

        case 'error':
          this.callbacks.onError?.(msg.error);
          break;

        case 'input-ack':
          this.callbacks.onInputAck?.(msg.inputType, msg.success, msg.error);
          break;

        case 'config-ack':
          this.callbacks.onConfigAck?.(msg.config);
          break;

        default:
          log.warn('Unknown message type from server', {
            type: (msg as Record<string, unknown>).type,
          });
      }
    } catch (err) {
      log.error('Failed to parse server message', { error: String(err) });
    }
  }

  private handleReconnect(): void {
    if (!this.options.reconnect || this.state === 'disconnected') return;

    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      log.error('Max reconnect attempts reached for browser stream');
      this.setState('disconnected');
      this.callbacks.onError?.('Max reconnect attempts reached');
      return;
    }

    this.setState('reconnecting');
    this.reconnectAttempts++;

    const delay = Math.min(
      this.options.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      30000,
    );

    log.info('Scheduling browser stream reconnect', { attempt: this.reconnectAttempts, delay });

    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(() => {
        // Reconnect error handling is done in connect()
      });
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
