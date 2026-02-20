/**
 * @agntk/core - Background Process Management Tool
 *
 * Manages long-running background processes with session tracking.
 * Ported from @agntk/brain shell to consolidate shell tools.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { spawn, type ChildProcess } from 'node:child_process';
import { isDangerousCommand, buildSanitizedEnv } from '../utils/shell';
import { MAX_COMMAND_LENGTH, MAX_CWD_LENGTH } from './constants';

// ============================================================================
// Types
// ============================================================================

export interface BackgroundSession {
  id: string;
  command: string;
  process: ChildProcess;
  stdout: string;
  stderr: string;
  startedAt: number;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  exitCode?: number;
  cwd?: string;
}

// ============================================================================
// Session Store
// ============================================================================

const MAX_BUFFER = 1024 * 1024; // 1MB
const ROLLING_BUFFER = 512 * 1024; // 512KB
const MAX_SESSIONS = 20;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

const backgroundSessions = new Map<string, BackgroundSession>();

function generateSessionId(): string {
  return `bg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Evict completed/stopped sessions when at capacity, or the oldest expired session.
 * M-1: prevents the Map from growing indefinitely.
 */
function evictSessions(): void {
  const now = Date.now();

  // First, remove TTL-expired entries regardless of capacity
  for (const [id, session] of backgroundSessions.entries()) {
    if (now - session.startedAt > SESSION_TTL_MS) {
      if (session.status === 'running') {
        try { session.process.kill('SIGTERM'); } catch { /* ignore */ }
      }
      backgroundSessions.delete(id);
    }
  }

  // Then, if still over cap, evict oldest completed/stopped session
  if (backgroundSessions.size >= MAX_SESSIONS) {
    for (const [id, session] of backgroundSessions.entries()) {
      if (session.status !== 'running') {
        backgroundSessions.delete(id);
        if (backgroundSessions.size < MAX_SESSIONS) break;
      }
    }
  }
}

/** Get all sessions (for testing). */
export function getBackgroundSessions(): Map<string, BackgroundSession> {
  return backgroundSessions;
}

/** Clear all sessions (for testing). */
export function clearBackgroundSessions(): void {
  for (const session of backgroundSessions.values()) {
    if (session.status === 'running') {
      try { session.process.kill('SIGTERM'); } catch (_e: unknown) { /* ignore */ }
    }
  }
  backgroundSessions.clear();
}

// ============================================================================
// Background Process Lifecycle
// ============================================================================

function startBackgroundProcess(
  command: string,
  options: { cwd?: string; env?: Record<string, string> } = {},
): BackgroundSession {
  // Evict old sessions before adding a new one (M-1)
  evictSessions();

  const sessionId = generateSessionId();
  const { cwd = process.cwd() } = options;

  // S-12: filter user-supplied env — strip secrets and disallow PATH/LD_PRELOAD overrides
  const filteredExtra: Record<string, string> = {};
  if (options.env) {
    for (const [k, v] of Object.entries(options.env)) {
      if (k === 'LD_PRELOAD' || k === 'LD_LIBRARY_PATH') continue; // block dangerous overrides
      filteredExtra[k] = v;
    }
  }

  const proc = spawn('bash', ['-c', command], {
    cwd,
    env: { ...buildSanitizedEnv(filteredExtra), TERM: 'dumb' },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const session: BackgroundSession = {
    id: sessionId,
    command,
    process: proc,
    stdout: '',
    stderr: '',
    startedAt: Date.now(),
    status: 'running',
    cwd,
  };

  proc.stdout?.on('data', (data: Buffer) => {
    session.stdout += data.toString();
    if (session.stdout.length > MAX_BUFFER) {
      session.stdout = session.stdout.slice(-ROLLING_BUFFER);
    }
  });

  proc.stderr?.on('data', (data: Buffer) => {
    session.stderr += data.toString();
    if (session.stderr.length > MAX_BUFFER) {
      session.stderr = session.stderr.slice(-ROLLING_BUFFER);
    }
  });

  proc.on('close', (code) => {
    session.status = code === 0 ? 'completed' : 'failed';
    session.exitCode = code ?? 1;
  });

  proc.on('error', () => {
    session.status = 'failed';
    session.exitCode = 1;
  });

  backgroundSessions.set(sessionId, session);
  return session;
}

// ============================================================================
// Tool Factory
// ============================================================================

const backgroundInputSchema = z.object({
  operation: z.enum(['start', 'status', 'output', 'stop', 'list']).describe('Operation to perform'),
  command: z.string().max(MAX_COMMAND_LENGTH).optional().describe('Command to run (required for start)'),
  sessionId: z.string().optional().describe('Session ID (required for status/output/stop)'),
  cwd: z.string().max(MAX_CWD_LENGTH).optional().describe('Working directory (for start)'),
  env: z.record(z.string()).optional().describe('Environment variables (for start)'),
});

/**
 * Create a background process management tool.
 *
 * @example
 * ```typescript
 * const tools = { shell: createShellTool('/my/project'), background: createBackgroundTool() };
 * ```
 */
export function createBackgroundTool() {
  return tool({
    description: `Run long-running processes in the background without blocking.

Operations:
- start: Start a new background process, returns session ID
- status: Check if a process is still running
- output: Get stdout/stderr from a running or completed process
- stop: Terminate a background process
- list: List all active background sessions

Use this tool for:
- Development servers (npm run dev, python -m http.server)
- Long-running builds or tests
- Watch commands (npm run watch)
- Database servers or other daemons

Examples:
- { "operation": "start", "command": "npm run dev" }
- { "operation": "status", "sessionId": "bg-123-abc" }
- { "operation": "output", "sessionId": "bg-123-abc" }
- { "operation": "stop", "sessionId": "bg-123-abc" }
- { "operation": "list" }`,
    inputSchema: backgroundInputSchema,
    execute: async ({ operation, command, sessionId, cwd, env }) => {
      switch (operation) {
        case 'start': {
          if (!command) {
            return JSON.stringify({ success: false, error: 'Command is required for start operation' });
          }
          if (isDangerousCommand(command)) {
            return JSON.stringify({ success: false, error: 'Command blocked for safety', blocked: true });
          }

          const session = startBackgroundProcess(command, { cwd, env });
          return JSON.stringify({
            success: true,
            sessionId: session.id,
            command: command.slice(0, 100),
            status: 'running',
            message: 'Process started in background. Use status/output to monitor.',
          });
        }

        case 'status': {
          if (!sessionId) {
            return JSON.stringify({ success: false, error: 'Session ID is required for status operation' });
          }
          const session = backgroundSessions.get(sessionId);
          if (!session) {
            return JSON.stringify({ success: false, error: `Session not found: ${sessionId}` });
          }
          return JSON.stringify({
            success: true,
            sessionId: session.id,
            status: session.status,
            exitCode: session.exitCode,
            runningFor: session.status === 'running'
              ? Math.round((Date.now() - session.startedAt) / 1000) + 's'
              : undefined,
            command: session.command.slice(0, 100),
          });
        }

        case 'output': {
          if (!sessionId) {
            return JSON.stringify({ success: false, error: 'Session ID is required for output operation' });
          }
          const session = backgroundSessions.get(sessionId);
          if (!session) {
            return JSON.stringify({ success: false, error: `Session not found: ${sessionId}` });
          }
          return JSON.stringify({
            success: true,
            sessionId: session.id,
            status: session.status,
            stdout: session.stdout.slice(-10000),
            stderr: session.stderr.slice(-5000),
            exitCode: session.exitCode,
          });
        }

        case 'stop': {
          if (!sessionId) {
            return JSON.stringify({ success: false, error: 'Session ID is required for stop operation' });
          }
          const session = backgroundSessions.get(sessionId);
          if (!session) {
            return JSON.stringify({ success: false, error: `Session not found: ${sessionId}` });
          }
          if (session.status !== 'running') {
            return JSON.stringify({
              success: true,
              message: `Session already ${session.status}`,
              exitCode: session.exitCode,
            });
          }
          try {
            session.process.kill('SIGTERM');
            session.status = 'stopped';
            setTimeout(() => {
              try {
                if (session.status === 'running') {
                  session.process.kill('SIGKILL');
                }
              } catch (_e: unknown) { /* ignore */ }
            }, 5000);
            return JSON.stringify({ success: true, message: 'Process terminated', sessionId: session.id });
          } catch (error) {
            return JSON.stringify({
              success: false,
              error: `Failed to stop process: ${error instanceof Error ? error.message : String(error)}`,
            });
          }
        }

        case 'list': {
          const sessions = Array.from(backgroundSessions.values()).map((s) => ({
            sessionId: s.id,
            command: s.command.slice(0, 50),
            status: s.status,
            startedAt: new Date(s.startedAt).toISOString(),
            exitCode: s.exitCode,
          }));
          return JSON.stringify({ success: true, count: sessions.length, sessions });
        }

        default:
          return JSON.stringify({ success: false, error: `Unknown operation: ${operation}` });
      }
    },
  });
}
