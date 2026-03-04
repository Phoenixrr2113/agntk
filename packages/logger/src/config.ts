import { EventEmitter } from 'node:events';
import type { DebugConfig, LogLevel, LogTransport, LogEntry } from './types';
import { parseDebugEnv } from './namespace';
import { createConsoleTransport } from './transports/console';
import { createFileTransport } from './transports/file';

let globalConfig: DebugConfig | null = null;

const logEmitter = new EventEmitter();
logEmitter.setMaxListeners(100);

export function getLogEmitter(): EventEmitter {
  return logEmitter;
}

export function emitLog(entry: LogEntry): void {
  logEmitter.emit('log', entry);
}

function getDefaultConfig(): DebugConfig {
  const debug = process.env['DEBUG'];
  const { enabled, excluded } = parseDebugEnv(debug);

  const levelEnv = process.env['DEBUG_LEVEL']?.toLowerCase() as LogLevel | undefined;
  const level: LogLevel =
    levelEnv && ['error', 'warn', 'info', 'debug', 'trace'].includes(levelEnv) ? levelEnv : 'debug';

  const formatEnv = process.env['DEBUG_FORMAT']?.toLowerCase();
  const format: 'pretty' | 'json' = formatEnv === 'json' ? 'json' : 'pretty';

  const colors = process.env['DEBUG_COLORS'] !== 'false' && (process.stdout.isTTY ?? false);

  const transports: LogTransport[] = [createConsoleTransport({ format, colors })];

  const debugFile = process.env['DEBUG_FILE'];
  if (debugFile) {
    transports.push(
      createFileTransport({
        path: debugFile,
        bufferSize: 1, // Flush immediately for real-time file output
      }),
    );
  }

  return {
    enabledPatterns: enabled,
    excludedPatterns: excluded,
    level,
    format,
    transports,
    colors,
  };
}

export function getConfig(): DebugConfig {
  if (!globalConfig) {
    globalConfig = getDefaultConfig();
  }
  return globalConfig;
}

export function configure(options: Partial<DebugConfig>): void {
  const current = getConfig();
  globalConfig = { ...current, ...options };
}

export function addTransport(transport: LogTransport): void {
  const config = getConfig();
  config.transports.push(transport);
}

export function resetConfig(): void {
  globalConfig = null;
}

export function enable(patterns: string | string[]): void {
  const config = getConfig();
  const newPatterns = Array.isArray(patterns) ? patterns : [patterns];
  config.enabledPatterns = [...config.enabledPatterns, ...newPatterns];
}

export function disable(patterns: string | string[]): void {
  const config = getConfig();
  const newPatterns = Array.isArray(patterns) ? patterns : [patterns];
  config.excludedPatterns = [...config.excludedPatterns, ...newPatterns];
}

export async function flush(): Promise<void> {
  const config = getConfig();
  await Promise.all(config.transports.map((t) => t.flush?.()));
}

export async function close(): Promise<void> {
  const config = getConfig();
  await Promise.all(config.transports.map((t) => t.close?.()));
}
