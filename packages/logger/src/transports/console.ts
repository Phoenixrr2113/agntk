import type { LogTransport, LogEntry } from '../types';
import { formatPretty, formatJSON } from '../formatter';

export interface ConsoleTransportOptions {
  format?: 'pretty' | 'json';

  colors?: boolean;
}

export function createConsoleTransport(options: ConsoleTransportOptions = {}): LogTransport {
  const format = options.format ?? 'pretty';
  const colors = options.colors ?? process.stdout.isTTY ?? false;

  return {
    name: 'console',

    write(entry: LogEntry): void {
      const line = format === 'json' ? formatJSON(entry) : formatPretty(entry, colors);

      if (entry.level === 'error' || entry.level === 'warn') {
        process.stderr.write(line + '\n');
      } else {
        process.stdout.write(line + '\n');
      }
    },
  };
}
