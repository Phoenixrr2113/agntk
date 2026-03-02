/**
 * @fileoverview Terminal UI primitives — colors, spinner, formatting helpers.
 * No internal dependencies. Auto-disables ANSI when piped.
 */

// ============================================================================
// ANSI Colors — auto-disabled when piped
// ============================================================================

export interface Colors {
  dim: (s: string) => string;
  bold: (s: string) => string;
  cyan: (s: string) => string;
  yellow: (s: string) => string;
  green: (s: string) => string;
  red: (s: string) => string;
  magenta: (s: string) => string;
  blue: (s: string) => string;
  white: (s: string) => string;
  reset: string;
}

export function createColors(enabled: boolean): Colors {
  if (!enabled) {
    const identity = (s: string) => s;
    return {
      dim: identity,
      bold: identity,
      cyan: identity,
      yellow: identity,
      green: identity,
      red: identity,
      magenta: identity,
      blue: identity,
      white: identity,
      reset: '',
    };
  }
  return {
    dim: (s) => `\x1b[2m${s}\x1b[22m`,
    bold: (s) => `\x1b[1m${s}\x1b[22m`,
    cyan: (s) => `\x1b[36m${s}\x1b[39m`,
    yellow: (s) => `\x1b[33m${s}\x1b[39m`,
    green: (s) => `\x1b[32m${s}\x1b[39m`,
    red: (s) => `\x1b[31m${s}\x1b[39m`,
    magenta: (s) => `\x1b[35m${s}\x1b[39m`,
    blue: (s) => `\x1b[34m${s}\x1b[39m`,
    white: (s) => `\x1b[97m${s}\x1b[39m`,
    reset: '\x1b[0m',
  };
}

// ============================================================================
// Spinner — braille-pattern loading indicator
// ============================================================================

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const CLEAR_LINE = '\x1b[2K\r';

export interface Spinner {
  start: (label: string) => void;
  stop: () => void;
}

export function createSpinner(
  stream: NodeJS.WritableStream,
  colors: Colors,
  enabled: boolean,
): Spinner {
  let interval: ReturnType<typeof setInterval> | null = null;
  let frameIdx = 0;

  return {
    start(label: string) {
      if (!enabled) return;
      this.stop();
      frameIdx = 0;
      interval = setInterval(() => {
        const frame = SPINNER_FRAMES[frameIdx % SPINNER_FRAMES.length]!;
        stream.write(`${CLEAR_LINE}  ${colors.cyan(frame)} ${colors.dim(label)}`);
        frameIdx++;
      }, 80);
    },
    stop() {
      if (interval) {
        clearInterval(interval);
        interval = null;
        stream.write(CLEAR_LINE);
      }
    },
  };
}

// ============================================================================
// Formatting Helpers
// ============================================================================

/** Compact summary of tool args — show key names and short values */
export function summarizeArgs(input: unknown, colors: Colors): string {
  if (!input || typeof input !== 'object') return '';
  const obj = input as Record<string, unknown>;
  const parts: string[] = [];
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined || val === null) continue;
    const str = typeof val === 'string' ? val : JSON.stringify(val);
    const display = str.length > 60 ? str.slice(0, 57) + '...' : str;
    parts.push(`${colors.dim(key + '=')}${colors.yellow(display)}`);
  }
  return parts.join(' ');
}

/** Compact summary of tool output */
export function summarizeOutput(output: unknown): string {
  const raw = typeof output === 'string' ? output : JSON.stringify(output);
  let display = raw;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.output === 'string') {
      display = parsed.output;
    }
  } catch {
    // use raw
  }
  const lines = display.split('\n');
  if (lines.length > 3) {
    return lines.slice(0, 3).join('\n') + `\n  ... (${lines.length} lines total)`;
  }
  if (display.length > 200) {
    return display.slice(0, 197) + '...';
  }
  return display;
}

/** Format milliseconds into human-readable duration */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m${secs}s`;
}
