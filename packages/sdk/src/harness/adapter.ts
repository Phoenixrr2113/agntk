import { createLogger } from '@agntk/logger';
import type { AgentEvent } from './events';

const log = createLogger('@agntk/core:harness-adapter');

export interface Adapter {
  name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onEvent(handler: (event: AgentEvent) => void): void;
}

export abstract class BaseAdapter implements Adapter {
  abstract readonly name: string;

  protected handlers: Array<(event: AgentEvent) => void> = [];
  protected connected = false;

  async connect(): Promise<void> {
    if (this.connected) return;
    this.connected = true;
    log.info('Adapter connected', { name: this.name });
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    this.handlers = [];
    log.info('Adapter disconnected', { name: this.name });
  }

  onEvent(handler: (event: AgentEvent) => void): void {
    this.handlers.push(handler);
  }

  protected emit(event: AgentEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (err) {
        log.warn('Event handler error', {
          adapter: this.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  isConnected(): boolean {
    return this.connected;
  }
}
