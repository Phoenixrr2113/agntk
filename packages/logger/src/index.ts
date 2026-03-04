export type { LogLevel, LogEntry, LogTransport, Logger, LoggerOptions, DebugConfig } from './types';

export { LOG_LEVELS } from './types';

export { createLogger, createNoopLogger } from './logger';

export {
  getConfig,
  configure,
  addTransport,
  resetConfig,
  enable,
  disable,
  flush,
  close,
  getLogEmitter,
} from './config';

export {
  createConsoleTransport,
  createFileTransport,
  createSSETransport,
  type ConsoleTransportOptions,
  type FileTransportOptions,
  type SSETransportOptions,
  type SSETransport,
  type SSEClient,
} from './transports';

export { parseDebugEnv, matchesPattern, isNamespaceEnabled, childNamespace } from './namespace';

export { formatPretty, formatJSON, formatSSE } from './formatter';
