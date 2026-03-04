import type { LogTransport, LogEntry } from '../types';
import { formatSSE } from '../formatter';

export interface SSEClient {
  write(data: string): boolean;
}

export interface SSETransport extends LogTransport {
  addClient(client: SSEClient): void;

  removeClient(client: SSEClient): void;

  clientCount(): number;
}

export interface SSETransportOptions {
  bufferSize?: number;

  sendHistory?: boolean;
}

export function createSSETransport(options: SSETransportOptions = {}): SSETransport {
  const { bufferSize = 100, sendHistory = true } = options;
  const clients = new Set<SSEClient>();
  const buffer: LogEntry[] = [];

  return {
    name: 'sse',

    write(entry: LogEntry): void {
      buffer.push(entry);
      if (buffer.length > bufferSize) {
        buffer.shift();
      }

      const sseData = formatSSE(entry);
      for (const client of clients) {
        try {
          client.write(sseData);
        } catch {
          clients.delete(client);
        }
      }
    },

    addClient(client: SSEClient): void {
      clients.add(client);

      if (sendHistory && buffer.length > 0) {
        for (const entry of buffer) {
          try {
            client.write(formatSSE(entry));
          } catch {
            clients.delete(client);
            break;
          }
        }
      }
    },

    removeClient(client: SSEClient): void {
      clients.delete(client);
    },

    clientCount(): number {
      return clients.size;
    },
  };
}
