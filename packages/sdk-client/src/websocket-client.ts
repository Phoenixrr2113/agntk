// WebSocket client for streaming

import { createLogger } from '@agntk/logger';
import { WebSocketError } from './errors';
import type { StreamEvent, ChatMessage, TokenUsage } from './types';

const log = createLogger('@agntk/client:ws');

export interface WebSocketClientConfig {
  url: string;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export type WebSocketCallbacks = {
  onTextDelta?: (text: string) => void;
  onToolCall?: (toolCallId: string, name: string, args: unknown) => void;
  onToolResult?: (toolCallId: string, name: string, result: unknown) => void;
  onStepStart?: (index: number) => void;
  onStepFinish?: (index: number, finishReason: string) => void;
  onComplete?: (result: { text: string; usage?: TokenUsage }) => void;
  onError?: (error: string) => void;
};

export class AgentWebSocketClient {
  private ws: WebSocket | null = null;
  private config: WebSocketClientConfig;
  private state: ConnectionState = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private onStateChange?: (state: ConnectionState) => void;

  constructor(config: WebSocketClientConfig) {
    this.config = {
      reconnect: true,
      reconnectInterval: 1000,
      maxReconnectAttempts: 5,
      ...config,
    };
    log.debug('Created WebSocket client', { url: config.url });
  }

  getState(): ConnectionState {
    return this.state;
  }

  onConnectionStateChange(handler: (state: ConnectionState) => void) {
    this.onStateChange = handler;
  }

  private setState(newState: ConnectionState) {
    if (this.state !== newState) {
      this.state = newState;
      this.onStateChange?.(newState);
      log.debug('Connection state changed', { state: newState });
    }
  }

  connect(): Promise<void> {
    if (this.state === 'connected') return Promise.resolve();

    this.setState('connecting');
    log.debug('Connecting');

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.config.url);

        this.ws.onopen = () => {
          log.info('Connected');
          this.setState('connected');
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onclose = () => {
          log.info('Connection closed');
          if (this.state !== 'disconnected') {
            this.handleReconnect();
          }
        };

        this.ws.onerror = (error) => {
          log.error('Connection failed', { error });
          if (this.state === 'connecting') {
            this.setState('disconnected');
            reject(new WebSocketError('Connection failed'));
          }
        };
      } catch {
        this.setState('disconnected');
        reject(new WebSocketError('Failed to create WebSocket'));
      }
    });
  }

  private handleReconnect() {
    if (!this.config.reconnect || this.state === 'disconnected') return;

    if (this.reconnectAttempts >= (this.config.maxReconnectAttempts || 5)) {
      log.error('Max reconnect attempts reached');
      this.setState('disconnected');
      return;
    }

    this.setState('reconnecting');
    this.reconnectAttempts++;

    const delay = Math.min(
      (this.config.reconnectInterval || 1000) * Math.pow(2, this.reconnectAttempts - 1),
      30000,
    );

    log.info('Scheduling reconnect', { attempt: this.reconnectAttempts, delay });

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(() => {
        // Error handling is done in connect()
      });
    }, delay);
  }

  send(message: ChatMessage, callbacks: WebSocketCallbacks): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new WebSocketError('WebSocket not connected');
    }
    log.debug('Sending message');
    this.ws.send(JSON.stringify(message));

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as StreamEvent;
        this.dispatch(data, callbacks);
      } catch {
        callbacks.onError?.('Failed to parse message');
      }
    };
  }

  private dispatch(event: StreamEvent, callbacks: WebSocketCallbacks): void {
    switch (event.type) {
      case 'text-delta':
        callbacks.onTextDelta?.(event.textDelta);
        break;

      case 'tool-call':
        callbacks.onToolCall?.(event.toolCallId, event.toolName, event.args);
        break;

      case 'tool-result':
        callbacks.onToolResult?.(event.toolCallId, event.toolName, event.result);
        break;

      case 'step-start':
        callbacks.onStepStart?.(event.stepIndex);
        break;

      case 'step-finish':
        callbacks.onStepFinish?.(event.stepIndex, event.finishReason);
        break;

      case 'finish':
        callbacks.onComplete?.({ text: event.text, usage: event.usage });
        break;

      case 'error':
        callbacks.onError?.(event.error);
        break;
    }
  }

  disconnect(): void {
    log.debug('Disconnecting');
    this.setState('disconnected');
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }
}
