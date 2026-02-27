#!/usr/bin/env node

/**
 * @fileoverview CLI entry point for agntk — zero-config AI agent.
 *
 * Usage:
 *   npx agntk "do something"
 *   npx agntk whats up
 *   npx agntk -n "my-agent" "fix the failing tests"
 *   npx agntk -n "my-agent" --instructions "you are a deploy bot" "roll back staging"
 *   npx agntk -n "my-agent" -i
 *   npx agntk list
 *   cat error.log | npx agntk -n "debugger" "explain these errors"
 */

// Load .env files before anything else reads process.env
import 'dotenv/config';

import { createInterface, type Interface } from 'node:readline';
import { readdirSync, existsSync, writeFileSync, unlinkSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { getVersion } from './version.js';
import { detectApiKey, loadDotenvFallback } from './config.js';

// ============================================================================
// Constants
// ============================================================================

const AGENTS_DIR = resolve(homedir(), '.agntk', 'agents');

// ============================================================================
// ANSI Colors — auto-disabled when piped
// ============================================================================

interface Colors {
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

function createColors(enabled: boolean): Colors {
  if (!enabled) {
    const identity = (s: string) => s;
    return { dim: identity, bold: identity, cyan: identity, yellow: identity, green: identity, red: identity, magenta: identity, blue: identity, white: identity, reset: '' };
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

interface Spinner {
  start: (label: string) => void;
  stop: () => void;
}

function createSpinner(stream: NodeJS.WritableStream, colors: Colors, enabled: boolean): Spinner {
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
// Arg Parsing — intentionally minimal
// ============================================================================

type OutputLevel = 'quiet' | 'normal' | 'verbose';

interface CLIArgs {
  name: string | null;
  instructions: string | null;
  prompt: string | null;
  interactive: boolean;
  workspace: string;
  outputLevel: OutputLevel;
  maxSteps: number;
  help: boolean;
  version: boolean;
  list: boolean;
}

function parseCLIArgs(argv: string[]): CLIArgs {
  const args: CLIArgs = {
    name: null,
    instructions: null,
    prompt: null,
    interactive: false,
    workspace: process.cwd(),
    outputLevel: 'normal',
    maxSteps: 25,
    help: false,
    version: false,
    list: false,
  };

  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;

    switch (arg) {
      case '--name':
      case '-n':
        args.name = argv[++i] ?? null;
        break;
      case '--instructions':
        args.instructions = argv[++i] ?? null;
        break;
      case '-i':
      case '--interactive':
        args.interactive = true;
        break;
      case '--workspace':
        args.workspace = argv[++i] ?? process.cwd();
        break;
      case '--verbose':
        args.outputLevel = 'verbose';
        break;
      case '-q':
      case '--quiet':
        args.outputLevel = 'quiet';
        break;
      case '--max-steps':
        args.maxSteps = parseInt(argv[++i] ?? '25', 10);
        break;
      case '-h':
      case '--help':
        args.help = true;
        break;
      case '-v':
      case '--version':
        args.version = true;
        break;
      case 'list':
        if (positionals.length === 0) {
          args.list = true;
        } else {
          positionals.push(arg);
        }
        break;
      default:
        if (!arg.startsWith('-')) {
          positionals.push(arg);
        }
        break;
    }
  }

  // Interpret positionals:
  //   All positionals join into the prompt. Use --name/-n for agent name.
  //   agntk "do something"              → prompt = "do something"
  //   agntk whats up                    → prompt = "whats up"
  //   agntk -n myagent fix the tests    → name = "myagent", prompt = "fix the tests"
  if (positionals.length > 0) {
    args.prompt = positionals.join(' ');
  }

  return args;
}

// ============================================================================
// Help
// ============================================================================

function printHelp(): void {
  const version = getVersion();
  console.log(`
  agntk (${version}) — zero-config AI agent

  Usage:
    agntk "prompt"
    agntk -n <name> "prompt"
    agntk -n <name> -i
    agntk list

  Options:
    -n, --name <name>        Agent name (enables persistent memory)
    --instructions <text>    What the agent does (injected as system prompt)
    -i, --interactive        Interactive REPL mode
    --workspace <path>       Workspace root (default: cwd)
    --max-steps <n>          Max tool-loop steps (default: 25)
    --verbose                Show full tool args and output
    -q, --quiet              Text output only (for piping)
    -v, --version            Show version
    -h, --help               Show help

  Commands:
    list                     List all known agents

  Examples:
    agntk "fix the failing tests"
    agntk whats up
    agntk -n coder "fix the failing tests"
    agntk -n ops --instructions "you manage k8s deploys" "roll back staging"
    agntk -n coder -i
    agntk list
    cat error.log | agntk -n debugger "explain"

  Provider (auto-detected):
    Works out of the box with the free tier (Cerebras).
    For your own key:  export OPENROUTER_API_KEY=sk-or-...
    For local models:  install Ollama (auto-detected at localhost:11434)
`);
}

// ============================================================================
// List Agents
// ============================================================================

/** Check if a PID is still alive */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Format a timestamp as relative time (e.g. "2m ago", "3d ago") */
function relativeTime(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

/** Get lock info for an agent — returns PID if running, null if idle */
function getAgentLockInfo(agentDir: string): { pid: number; alive: boolean } | null {
  const lockPath = join(agentDir, '.lock');
  if (!existsSync(lockPath)) return null;
  try {
    const content = readFileSync(lockPath, 'utf-8').trim();
    const pid = parseInt(content, 10);
    if (isNaN(pid)) return null;
    const alive = isPidAlive(pid);
    if (!alive) {
      try { unlinkSync(lockPath); } catch { /* ignore */ }
      return null;
    }
    return { pid, alive };
  } catch {
    return null;
  }
}

/** Acquire a lockfile for an agent */
function acquireLock(name: string): void {
  const lockPath = join(AGENTS_DIR, name, '.lock');
  try {
    writeFileSync(lockPath, String(process.pid), 'utf-8');
  } catch {
    // Agent dir may not exist yet — that's fine, it gets created by the SDK
  }
}

/** Release a lockfile for an agent */
function releaseLock(name: string): void {
  const lockPath = join(AGENTS_DIR, name, '.lock');
  try {
    unlinkSync(lockPath);
  } catch {
    // Already cleaned up
  }
}

function listAgents(): void {
  const colors = createColors(process.stdout.isTTY ?? false);

  if (!existsSync(AGENTS_DIR)) {
    console.log(colors.dim('No agents found. Create one with: agntk --name "my-agent" "do something"'));
    return;
  }

  const entries = readdirSync(AGENTS_DIR, { withFileTypes: true });
  const agents = entries.filter((e) => e.isDirectory());

  if (agents.length === 0) {
    console.log(colors.dim('No agents found. Create one with: agntk --name "my-agent" "do something"'));
    return;
  }

  console.log(`\n${colors.bold(`Agents (${agents.length})`)}\n`);

  // Calculate max name length for alignment
  const maxNameLen = Math.max(...agents.map((a) => a.name.length));

  for (const agent of agents) {
    const agentDir = join(AGENTS_DIR, agent.name);
    const memoryPath = join(agentDir, 'memory.md');
    const contextPath = join(agentDir, 'context.md');
    const hasMemory = existsSync(memoryPath);
    const hasContext = existsSync(contextPath);

    // Running detection
    const lockInfo = getAgentLockInfo(agentDir);
    const isRunning = lockInfo !== null;

    // Last active — most recent mtime of any file in the agent dir
    let lastActive: Date | null = null;
    try {
      const agentFiles = readdirSync(agentDir);
      for (const f of agentFiles) {
        if (f === '.lock') continue;
        try {
          const fStat = statSync(join(agentDir, f));
          if (!lastActive || fStat.mtime > lastActive) {
            lastActive = fStat.mtime;
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }

    // Build output line
    const statusIcon = isRunning
      ? colors.green('●')
      : colors.dim('○');
    const nameStr = isRunning
      ? colors.green(colors.bold(agent.name))
      : agent.name;
    const padding = ' '.repeat(maxNameLen - agent.name.length + 2);

    const parts: string[] = [];
    if (isRunning) {
      parts.push(colors.green(`running`) + colors.dim(` (pid ${lockInfo!.pid})`));
    } else {
      parts.push(colors.dim('idle'));
    }
    if (lastActive) {
      parts.push(colors.dim(relativeTime(lastActive)));
    }
    if (hasMemory) {
      parts.push(colors.cyan('🧠 memory'));
    } else if (hasContext) {
      parts.push(colors.dim('has context'));
    }

    console.log(`  ${statusIcon} ${nameStr}${padding}${parts.join(colors.dim('  ·  '))}`);
  }
  console.log('');
}

// ============================================================================
// Formatting Helpers
// ============================================================================

/** Compact summary of tool args — show key names and short values */
function summarizeArgs(input: unknown, colors: Colors): string {
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
function summarizeOutput(output: unknown): string {
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
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m${secs}s`;
}

// ============================================================================
// Stream Consumer — renders agent activity to terminal
// ============================================================================

interface StreamConsumerOptions {
  output: NodeJS.WritableStream;
  status: NodeJS.WritableStream;
  level: OutputLevel;
  colors: Colors;
  maxSteps?: number;
  isTTY?: boolean;
}

interface StreamStats {
  steps: number;
  toolCalls: number;
  startTime: number;
  inputTokens: number;
  outputTokens: number;
}

async function consumeStream(
  stream: AsyncIterable<{ type: string; [key: string]: unknown }>,
  opts: StreamConsumerOptions,
): Promise<StreamStats> {
  const { output, status, level, colors } = opts;
  const quiet = level === 'quiet';
  const verbose = level === 'verbose';
  const spinner = createSpinner(status, colors, !quiet && (opts.isTTY ?? false));

  const stats: StreamStats = {
    steps: 0,
    toolCalls: 0,
    startTime: Date.now(),
    inputTokens: 0,
    outputTokens: 0,
  };

  let afterToolResult = false;
  let currentStepStart = Date.now();
  let inReasoning = false;
  let hasTextOutput = false;
  let lastToolOutput: string | null = null;

  // Reflection tag filtering state machine.
  let inReflection = false;
  let reflectionBuffer = '';
  const REFLECTION_OPEN = '<reflection>';
  const REFLECTION_CLOSE = '</reflection>';

  for await (const chunk of stream) {
    switch (chunk.type) {
      case 'start-step': {
        stats.steps++;
        currentStepStart = Date.now();
        if (!quiet) {
          status.write(`\n${colors.dim('──')} ${colors.blue(colors.bold(`step ${stats.steps}`))} ${colors.dim('──────────────────────────────────────')}\n`);
        }
        break;
      }

      case 'finish-step': {
        if (reflectionBuffer && !inReflection) {
          if (reflectionBuffer.trim()) {
            if (afterToolResult && !quiet) {
              output.write('\n');
              afterToolResult = false;
            }
            hasTextOutput = true;
            output.write(reflectionBuffer);
          }
          reflectionBuffer = '';
        }
        inReflection = false;

        if (!quiet) {
          const elapsed = Date.now() - currentStepStart;
          const reason = chunk.finishReason as string ?? 'unknown';
          const usage = chunk.usage as { inputTokens?: number; outputTokens?: number } | undefined;
          const tokensIn = usage?.inputTokens ?? 0;
          const tokensOut = usage?.outputTokens ?? 0;
          stats.inputTokens += tokensIn;
          stats.outputTokens += tokensOut;

          const parts = [
            colors.dim(`  ${formatDuration(elapsed)}`),
            `${colors.cyan(String(tokensIn))}${colors.dim('→')}${colors.cyan(String(tokensOut))} ${colors.dim('tok')}`,
          ];
          if (reason === 'tool-calls') {
            parts.push(colors.dim('→ tool loop'));
          } else if (reason === 'stop') {
            parts.push(colors.green(colors.bold('done')));
          } else {
            parts.push(colors.yellow(reason));
          }
          status.write(`${parts.join(colors.dim(' | '))}\n`);
        }
        break;
      }

      case 'reasoning-start': {
        if (!quiet) {
          inReasoning = true;
          status.write(colors.magenta('\n  💭 '));
        }
        break;
      }

      case 'reasoning-delta': {
        if (!quiet && inReasoning) {
          const text = (chunk.text as string) ?? '';
          const compacted = text.replace(/\n/g, ' ');
          status.write(colors.magenta(colors.dim(compacted)));
        }
        break;
      }

      case 'reasoning-end': {
        if (!quiet && inReasoning) {
          status.write('\n');
          inReasoning = false;
        }
        break;
      }

      case 'tool-call': {
        stats.toolCalls++;
        if (!quiet) {
          const toolName = chunk.toolName as string;
          if (verbose) {
            const argsStr = chunk.input ? JSON.stringify(chunk.input, null, 2) : '';
            status.write(`\n  ${colors.cyan('▶')} ${colors.cyan(colors.bold(toolName))}\n`);
            if (argsStr) {
              const indented = argsStr.split('\n').map((l) => `     ${l}`).join('\n');
              status.write(`${colors.dim(indented)}\n`);
            }
          } else {
            const argsSummary = summarizeArgs(chunk.input, colors);
            const display = argsSummary
              ? `  ${colors.cyan('▶')} ${colors.cyan(colors.bold(toolName))} ${argsSummary}`
              : `  ${colors.cyan('▶')} ${colors.cyan(colors.bold(toolName))}`;
            status.write(`${display}\n`);
          }
          spinner.start(`running ${toolName}...`);
        }
        afterToolResult = false;
        break;
      }

      case 'tool-result': {
        spinner.stop();
        const toolOutputRaw = typeof chunk.output === 'string' ? chunk.output : JSON.stringify(chunk.output);
        try {
          const parsed = JSON.parse(toolOutputRaw);
          lastToolOutput = (parsed && typeof parsed.output === 'string') ? parsed.output : toolOutputRaw;
        } catch {
          lastToolOutput = toolOutputRaw;
        }

        if (!quiet) {
          const toolName = chunk.toolName as string;
          if (verbose) {
            let displayOutput = lastToolOutput ?? '';
            const maxLen = 2000;
            if (displayOutput.length > maxLen) {
              displayOutput = displayOutput.slice(0, maxLen) + `\n... (${displayOutput.length} chars total)`;
            }
            const indented = displayOutput.split('\n').map((l) => `     ${l}`).join('\n');
            status.write(`  ${colors.green('✔')} ${colors.green(colors.dim(toolName))} ${colors.dim('returned')}\n`);
            status.write(`${colors.dim(indented)}\n`);
          } else {
            const summary = summarizeOutput(chunk.output);
            const firstLine = summary.split('\n')[0]!;
            const truncated = firstLine.length > 100
              ? firstLine.slice(0, 97) + '...'
              : firstLine;
            status.write(`  ${colors.green('✔')} ${colors.green(colors.dim(toolName + ': '))}${colors.dim(truncated)}\n`);
          }
        }
        afterToolResult = true;
        break;
      }

      case 'tool-error': {
        spinner.stop();
        if (!quiet) {
          const toolName = chunk.toolName as string;
          const error = chunk.error instanceof Error
            ? chunk.error.message
            : String(chunk.error ?? 'unknown error');
          status.write(`  ${colors.red('✖')} ${colors.red(colors.bold(toolName))} ${colors.red(error)}\n`);
        }
        afterToolResult = true;
        break;
      }

      case 'text-delta': {
        const rawText = (chunk.text as string) ?? '';
        if (!rawText) break;

        reflectionBuffer += rawText;

        while (reflectionBuffer.length > 0) {
          if (inReflection) {
            const closeIdx = reflectionBuffer.indexOf(REFLECTION_CLOSE);
            if (closeIdx !== -1) {
              const content = reflectionBuffer.slice(0, closeIdx);
              reflectionBuffer = reflectionBuffer.slice(closeIdx + REFLECTION_CLOSE.length);
              inReflection = false;

              if (verbose) {
                const trimmed = content.trim();
                if (trimmed) {
                  status.write(colors.dim(`  ... ${trimmed}\n`));
                }
              }
            } else {
              break;
            }
          } else {
            const openIdx = reflectionBuffer.indexOf(REFLECTION_OPEN);
            if (openIdx !== -1) {
              const before = reflectionBuffer.slice(0, openIdx);
              if (before) {
                if (afterToolResult && !quiet) {
                  output.write('\n');
                  afterToolResult = false;
                }
                if (before.trim()) hasTextOutput = true;
                output.write(before);
              }
              reflectionBuffer = reflectionBuffer.slice(openIdx + REFLECTION_OPEN.length);
              inReflection = true;
            } else {
              let partialAt = -1;
              for (let i = Math.max(0, reflectionBuffer.length - REFLECTION_OPEN.length); i < reflectionBuffer.length; i++) {
                if (reflectionBuffer[i] === '<') {
                  const partial = reflectionBuffer.slice(i);
                  if (REFLECTION_OPEN.startsWith(partial)) {
                    partialAt = i;
                    break;
                  }
                }
              }

              if (partialAt !== -1) {
                const safe = reflectionBuffer.slice(0, partialAt);
                if (safe) {
                  if (afterToolResult && !quiet) {
                    output.write('\n');
                    afterToolResult = false;
                  }
                  if (safe.trim()) hasTextOutput = true;
                  output.write(safe);
                }
                reflectionBuffer = reflectionBuffer.slice(partialAt);
                break;
              } else {
                if (afterToolResult && !quiet) {
                  output.write('\n');
                  afterToolResult = false;
                }
                if (reflectionBuffer.trim()) hasTextOutput = true;
                output.write(reflectionBuffer);
                reflectionBuffer = '';
              }
            }
          }
        }
        break;
      }

      case 'finish': {
        spinner.stop();
        if (!quiet) {
          const elapsed = Date.now() - stats.startTime;
          const totalUsage = chunk.totalUsage as { inputTokens?: number; outputTokens?: number } | undefined;
          if (totalUsage) {
            stats.inputTokens = totalUsage.inputTokens ?? stats.inputTokens;
            stats.outputTokens = totalUsage.outputTokens ?? stats.outputTokens;
          }
          const stepLabel = `${stats.steps} step${stats.steps !== 1 ? 's' : ''}`;
          const toolLabel = `${stats.toolCalls} tool call${stats.toolCalls !== 1 ? 's' : ''}`;
          const tokLabel = `${colors.cyan(String(stats.inputTokens))}${colors.dim('→')}${colors.cyan(String(stats.outputTokens))} ${colors.dim('tok')}`;
          const timeLabel = colors.dim(formatDuration(elapsed));
          status.write(`\n${colors.dim('──')} ${colors.green(colors.bold('done'))} ${colors.dim('──')} ${colors.dim(stepLabel)} ${colors.dim('|')} ${colors.dim(toolLabel)} ${colors.dim('|')} ${tokLabel} ${colors.dim('|')} ${timeLabel} ${colors.dim('──')}\n`);
        }
        break;
      }

      case 'error': {
        spinner.stop();
        const error = chunk.error instanceof Error
          ? chunk.error.message
          : String(chunk.error ?? 'unknown error');
        status.write(`\n${colors.red(colors.bold('✖ Error:'))} ${colors.red(error)}\n`);
        break;
      }

      default:
        break;
    }
  }

  const hitStepLimit = opts.maxSteps && stats.steps >= opts.maxSteps;

  if (hitStepLimit && !quiet) {
    status.write(`\n${colors.yellow('Warning: step limit reached')} ${colors.dim(`(${opts.maxSteps} steps). Use --max-steps to increase.`)}\n`);
  }

  if (!hasTextOutput && lastToolOutput && stats.toolCalls > 0 && !hitStepLimit) {
    if (!quiet) {
      output.write('\n');
    }
    output.write(lastToolOutput);
    if (!lastToolOutput.endsWith('\n')) {
      output.write('\n');
    }
  }

  return stats;
}

// ============================================================================
// Read piped stdin
// ============================================================================

async function readStdin(timeoutMs: number = 100): Promise<string | null> {
  if (process.stdin.isTTY) return null;

  return new Promise<string | null>((resolve) => {
    const chunks: Buffer[] = [];
    let resolved = false;

    const finish = () => {
      if (resolved) return;
      resolved = true;
      resolve(chunks.length === 0 ? null : Buffer.concat(chunks).toString('utf-8'));
    };

    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', finish);
    process.stdin.on('error', () => finish());
    setTimeout(finish, timeoutMs);
    process.stdin.resume();
  });
}

// ============================================================================
// One-Shot Mode
// ============================================================================

async function runOneShot(
  prompt: string,
  args: CLIArgs,
): Promise<void> {
  const { createAgent } = await import('@agntk/core');
  const colors = createColors(process.stderr.isTTY ?? false);

  const agent = createAgent({
    name: args.name!,
    instructions: args.instructions ?? undefined,
    workspaceRoot: args.workspace,
    maxSteps: args.maxSteps,
  });

  // Acquire lockfile
  acquireLock(args.name!);
  const cleanup = () => releaseLock(args.name!);
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });

  if (args.outputLevel !== 'quiet') {
    const toolCount = agent.getToolNames().length;
    process.stderr.write(
      `${colors.bold('agntk')} ${colors.dim('|')} ${colors.cyan(args.name!)} ${colors.dim('|')} ${colors.dim(`${toolCount} tools`)} ${colors.dim('|')} ${colors.dim(`workspace: ${args.workspace}`)}\n`,
    );
  }

  const result = await agent.stream({ prompt });

  await consumeStream(result.fullStream, {
    output: process.stdout,
    status: process.stderr,
    level: args.outputLevel,
    colors,
    maxSteps: args.maxSteps,
    isTTY: process.stderr.isTTY ?? false,
  });

  const finalText = await result.text;
  if (finalText && !finalText.endsWith('\n')) {
    process.stdout.write('\n');
  }

  if (args.outputLevel === 'verbose') {
    const usage = await result.usage;
    if (usage) {
      process.stderr.write(
        colors.dim(`[usage] ${usage.inputTokens ?? 0} input + ${usage.outputTokens ?? 0} output tokens\n`),
      );
    }
  }
}

// ============================================================================
// REPL Mode
// ============================================================================

async function runRepl(args: CLIArgs): Promise<void> {
  const { createAgent } = await import('@agntk/core');
  const colors = createColors(process.stdout.isTTY ?? false);

  const agent = createAgent({
    name: args.name!,
    instructions: args.instructions ?? undefined,
    workspaceRoot: args.workspace,
    maxSteps: args.maxSteps,
  });

  // Acquire lockfile
  acquireLock(args.name!);
  const cleanup = () => releaseLock(args.name!);
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });

  const version = getVersion();
  const output = process.stdout;
  const toolCount = agent.getToolNames().length;

  output.write(`\n${colors.bold('⚡ agntk')} ${colors.dim(`(${version})`)}\n`);
  output.write(`${colors.cyan(colors.bold(args.name!))} ${colors.dim('|')} ${colors.dim(`${toolCount} tools`)} ${colors.dim('|')} ${colors.green('memory: on')}\n`);
  output.write(`${colors.dim('Type /help for commands, /exit or Ctrl+C to quit.')}\n\n`);

  const rl: Interface = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${colors.cyan(colors.bold(args.name! + ' ❯'))} `,
    terminal: true,
  });

  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  const pendingLines: string[] = [];
  let busy = false;
  let closed = false;

  async function processLine(trimmed: string): Promise<void> {
    if (trimmed === '/exit' || trimmed === '/quit') {
      rl.close();
      return;
    }
    if (trimmed === '/help') {
      output.write(`\n  ${colors.bold('/help')}    Show commands\n  ${colors.bold('/tools')}   List available tools\n  ${colors.bold('/verbose')} Toggle verbose output\n  ${colors.bold('/exit')}    Quit\n\n`);
      rl.prompt();
      return;
    }
    if (trimmed === '/tools') {
      const tools = agent.getToolNames();
      output.write(`\n${colors.bold(`Tools (${tools.length})`)}:\n  ${tools.join(', ')}\n\n`);
      rl.prompt();
      return;
    }
    if (trimmed === '/verbose') {
      if (args.outputLevel === 'verbose') {
        args.outputLevel = 'normal';
        output.write(`${colors.dim('Verbose output: off')}\n`);
      } else {
        args.outputLevel = 'verbose';
        output.write(`${colors.dim('Verbose output: on')}\n`);
      }
      rl.prompt();
      return;
    }

    busy = true;
    rl.pause();

    history.push({ role: 'user', content: trimmed });

    const maxHistoryPairs = 10;
    const recentHistory = history.length > maxHistoryPairs * 2
      ? history.slice(-maxHistoryPairs * 2)
      : history;

    const historyLines = recentHistory.map((h) =>
      h.role === 'user' ? `[User]: ${h.content}` : `[Assistant]: ${h.content}`,
    );
    const contextPrompt = [
      '<conversation_history>',
      ...historyLines.slice(0, -1),
      '</conversation_history>',
      '',
      recentHistory[recentHistory.length - 1]!.content,
    ].join('\n');

    try {
      output.write('\n');
      const result = await agent.stream({ prompt: contextPrompt });
      await consumeStream(result.fullStream, {
        output,
        status: process.stderr,
        level: args.outputLevel,
        colors,
        maxSteps: args.maxSteps,
        isTTY: process.stderr.isTTY ?? false,
      });

      const responseText = (await result.text) ?? '';
      if (responseText && !responseText.endsWith('\n')) {
        output.write('\n');
      }

      history.push({ role: 'assistant', content: responseText });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      output.write(`\n${colors.red('Error:')} ${msg}\n`);
    }

    output.write('\n');
    busy = false;
    rl.resume();

    while (pendingLines.length > 0) {
      const next = pendingLines.shift()!;
      if (next) {
        await processLine(next);
      }
    }

    if (!closed) {
      rl.prompt();
    }
  }

  return new Promise<void>((resolvePromise) => {
    rl.prompt();

    rl.on('line', (line: string) => {
      const trimmed = line.trim();

      if (!trimmed) {
        rl.prompt();
        return;
      }

      if (busy) {
        pendingLines.push(trimmed);
        return;
      }

      processLine(trimmed).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        output.write(`\n${colors.red('Error:')} ${msg}\n`);
        rl.prompt();
      });
    });

    rl.on('close', () => {
      closed = true;

      const finish = () => {
        output.write(`\n${colors.dim('👋 Goodbye!')}\n`);
        resolvePromise();
      };

      if (busy) {
        const interval = setInterval(() => {
          if (!busy) {
            clearInterval(interval);
            finish();
          }
        }, 100);
      } else {
        finish();
      }
    });

    rl.on('SIGINT', () => {
      output.write('\n');
      rl.close();
    });
  });
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = parseCLIArgs(process.argv.slice(2));

  // Fast paths — no heavy imports
  if (args.version) {
    console.log(`agntk (${getVersion()})`);
    process.exit(0);
  }

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.list) {
    listAgents();
    process.exit(0);
  }

  // Validate: need a name
  if (!args.name) {
    if (!args.prompt && process.stdin.isTTY) {
      console.error(
        'Error: No prompt provided.\n' +
        'Usage: agntk "your prompt"\n' +
        '       agntk -n <name> "your prompt"\n' +
        '       agntk -n <name> -i\n' +
          '       agntk list\n' +
          '       agntk -h',
      );
      process.exit(1);
    }

    // Default name if no --name flag was given
    args.name = 'default';
  }

  // Resolve provider (async cascade: BYOK → Ollama → Free Tier)
  loadDotenvFallback();
  const { resolveProvider, setResolvedProvider } = await import('@agntk/core');
  const resolvedProvider = await resolveProvider();
  setResolvedProvider(resolvedProvider);

  if (args.outputLevel !== 'quiet') {
    const providerLabel = resolvedProvider.isFree
      ? `${resolvedProvider.source} — usage limits apply`
      : resolvedProvider.source;
    process.stderr.write(`  provider: ${providerLabel}\n`);

    // Show model recommendation for Ollama users
    if (resolvedProvider.ollamaModels) {
      const rec = resolvedProvider.ollamaModels;
      process.stderr.write(`  models:   ${rec.reason}\n`);
    }
  }

  // Warn if workspace is the home directory (likely unintentional)
  if (args.workspace === homedir()) {
    process.stderr.write(
      'Warning: Workspace is your home directory.\n' +
      '  Run from a project directory, or use --workspace <path>\n\n',
    );
  }

  // Interactive mode
  if (args.interactive) {
    await runRepl(args);
    process.exit(0);
  }

  // Build final prompt (handle piped stdin)
  let prompt = args.prompt;
  const pipedInput = await readStdin();
  if (pipedInput) {
    prompt = prompt ? `${pipedInput}\n\n${prompt}` : pipedInput;
  }

  if (!prompt) {
    console.error(
      'Error: No prompt provided.\n' +
      'Usage: agntk "your prompt"\n' +
      '       agntk -n <name> "your prompt"\n' +
      '       agntk -n <name> -i\n' +
        '       agntk -h',
    );
    process.exit(1);
  }

  // One-shot mode
  await runOneShot(prompt, args);

  // Flush observability traces before exit
  try {
    const { shutdownObservability } = await import('@agntk/core');
    await shutdownObservability();
  } catch {
    // Observability not available — that's fine
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err instanceof Error ? err.message : String(err));
  if (process.env.DEBUG) {
    console.error(err instanceof Error ? err.stack : '');
  }
  process.exit(1);
});
