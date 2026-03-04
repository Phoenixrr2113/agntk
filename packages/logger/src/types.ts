export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

export const LOG_LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

export interface LogEntry {
  timestamp: string;

  namespace: string;

  level: LogLevel;

  message: string;

  data?: Record<string, unknown>;

  durationMs?: number;

  id: string;
}

export interface LogTransport {
  name: string;

  write(entry: LogEntry): void;

  flush?(): Promise<void>;

  close?(): Promise<void>;
}

export interface Logger {
  error(message: string, data?: Record<string, unknown>): void;

  warn(message: string, data?: Record<string, unknown>): void;

  info(message: string, data?: Record<string, unknown>): void;

  debug(message: string, data?: Record<string, unknown>): void;

  trace(message: string, data?: Record<string, unknown>): void;

  child(context: Record<string, unknown>): Logger;

  isEnabled(): boolean;

  readonly namespace: string;

  time(label: string): () => void;
}

export interface LoggerOptions {
  level?: LogLevel;

  inheritedContext?: Record<string, unknown>;
}

export interface DebugConfig {
  enabledPatterns: string[];

  excludedPatterns: string[];

  level: LogLevel;

  format: 'pretty' | 'json';

  transports: LogTransport[];

  colors: boolean;
}
