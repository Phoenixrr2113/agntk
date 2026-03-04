import type { Logger, LoggerOptions, LogEntry, LogLevel } from './types';
import { LOG_LEVELS } from './types';
import { getConfig, emitLog } from './config';
import { isNamespaceEnabled } from './namespace';

let idCounter = 0;

function generateId(): string {
  return `${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
}

export function createLogger(namespace: string, options: LoggerOptions = {}): Logger {
  const { level, inheritedContext = {} } = options;

  function isEnabled(): boolean {
    return isNamespaceEnabled(namespace, getConfig());
  }

  function shouldLog(entryLevel: LogLevel): boolean {
    if (!isEnabled()) return false;

    const config = getConfig();
    const minLevel = level ?? config.level;
    return LOG_LEVELS[entryLevel] <= LOG_LEVELS[minLevel];
  }

  function log(entryLevel: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (!shouldLog(entryLevel)) return;

    const config = getConfig();

    const entry: LogEntry = {
      id: generateId(),
      timestamp: new Date().toISOString(),
      namespace,
      level: entryLevel,
      message,
      data: { ...inheritedContext, ...data },
    };

    if (entry.data && Object.keys(entry.data).length === 0) {
      delete entry.data;
    }

    for (const transport of config.transports) {
      try {
        transport.write(entry);
      } catch (err) {
        console.error(`[@agntk/logger] Transport "${transport.name}" failed:`, err);
      }
    }

    emitLog(entry);
  }

  const logger: Logger = {
    namespace,

    error: (message, data) => log('error', message, data),
    warn: (message, data) => log('warn', message, data),
    info: (message, data) => log('info', message, data),
    debug: (message, data) => log('debug', message, data),
    trace: (message, data) => log('trace', message, data),

    isEnabled,

    child(context: Record<string, unknown>): Logger {
      return createLogger(namespace, {
        ...options,
        inheritedContext: { ...inheritedContext, ...context },
      });
    },

    time(label: string): () => void {
      const start = performance.now();
      return () => {
        const durationMs = Math.round(performance.now() - start);

        if (!shouldLog('debug')) return;

        const config = getConfig();

        const entry: LogEntry = {
          id: generateId(),
          timestamp: new Date().toISOString(),
          namespace,
          level: 'debug',
          message: label,
          durationMs,
          data: inheritedContext,
        };

        if (entry.data && Object.keys(entry.data).length === 0) {
          delete entry.data;
        }

        for (const transport of config.transports) {
          try {
            transport.write(entry);
          } catch {
            void 0;
          }
        }
      };
    },
  };

  return logger;
}

const noop = () => {};

export function createNoopLogger(namespace: string): Logger {
  return {
    namespace,
    error: noop,
    warn: noop,
    info: noop,
    debug: noop,
    trace: noop,
    isEnabled: () => false,
    child: () => createNoopLogger(namespace),
    time: () => noop,
  };
}
