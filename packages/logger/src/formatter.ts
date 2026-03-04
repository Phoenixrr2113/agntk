import type { LogEntry, LogLevel } from './types';

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',

  error: '\x1b[31m', // red
  warn: '\x1b[33m', // yellow
  info: '\x1b[36m', // cyan
  debug: '\x1b[35m', // magenta
  trace: '\x1b[90m', // gray

  key: '\x1b[90m', // gray
  string: '\x1b[32m', // green
  number: '\x1b[33m', // yellow
};

const LEVEL_LABELS: Record<LogLevel, string> = {
  error: 'ERR',
  warn: 'WRN',
  info: 'INF',
  debug: 'DBG',
  trace: 'TRC',
};

const NAMESPACE_COLORS = [
  '\x1b[36m', // cyan
  '\x1b[35m', // magenta
  '\x1b[33m', // yellow
  '\x1b[32m', // green
  '\x1b[34m', // blue
  '\x1b[91m', // bright red
  '\x1b[92m', // bright green
  '\x1b[93m', // bright yellow
  '\x1b[94m', // bright blue
  '\x1b[95m', // bright magenta
  '\x1b[96m', // bright cyan
];

const namespaceColorCache = new Map<string, string>();

function getNamespaceColor(namespace: string): string {
  let color = namespaceColorCache.get(namespace);
  if (!color) {
    let hash = 0;
    for (let i = 0; i < namespace.length; i++) {
      hash = (hash << 5) - hash + namespace.charCodeAt(i);
      hash = hash & hash;
    }
    color = NAMESPACE_COLORS[Math.abs(hash) % NAMESPACE_COLORS.length];
    namespaceColorCache.set(namespace, color);
  }
  return color;
}

function formatDataPretty(data: Record<string, unknown>, useColors: boolean): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(data)) {
    let formatted: string;
    if (typeof value === 'string') {
      formatted = useColors
        ? `${COLORS.key}${key}${COLORS.reset}=${COLORS.string}"${value}"${COLORS.reset}`
        : `${key}="${value}"`;
    } else if (typeof value === 'number') {
      formatted = useColors
        ? `${COLORS.key}${key}${COLORS.reset}=${COLORS.number}${value}${COLORS.reset}`
        : `${key}=${value}`;
    } else if (value === null || value === undefined) {
      formatted = useColors
        ? `${COLORS.key}${key}${COLORS.reset}=${COLORS.dim}null${COLORS.reset}`
        : `${key}=null`;
    } else {
      const json = JSON.stringify(value);
      formatted = useColors
        ? `${COLORS.key}${key}${COLORS.reset}=${COLORS.dim}${json.slice(0, 50)}${json.length > 50 ? '...' : ''}${COLORS.reset}`
        : `${key}=${json.slice(0, 50)}${json.length > 50 ? '...' : ''}`;
    }
    parts.push(formatted);
  }

  return parts.join(' ');
}

export function formatPretty(entry: LogEntry, useColors: boolean = true): string {
  const levelColor = useColors ? COLORS[entry.level] : '';
  const reset = useColors ? COLORS.reset : '';
  const nsColor = useColors ? getNamespaceColor(entry.namespace) : '';

  const level = `${levelColor}${LEVEL_LABELS[entry.level]}${reset}`;
  const ns = `${nsColor}[${entry.namespace}]${reset}`;
  const msg = entry.message;

  let line = `${level} ${ns} ${msg}`;

  if (entry.durationMs !== undefined) {
    const duration = useColors
      ? `${COLORS.dim}+${entry.durationMs}ms${reset}`
      : `+${entry.durationMs}ms`;
    line += ` ${duration}`;
  }

  if (entry.data && Object.keys(entry.data).length > 0) {
    line += ` ${formatDataPretty(entry.data, useColors)}`;
  }

  return line;
}

export function formatJSON(entry: LogEntry): string {
  return JSON.stringify(entry);
}

export function formatSSE(entry: LogEntry): string {
  return `event: log\ndata: ${JSON.stringify(entry)}\nid: ${entry.id}\n\n`;
}
