/**
 * @fileoverview Agent management — lockfiles, listing, signal cleanup.
 */

import {
  readdirSync,
  existsSync,
  writeFileSync,
  unlinkSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { createColors } from './ui';

// Import the canonical agents dir path from the SDK — single source of truth.
import { AGENT_STATE_BASE } from '@agntk/core';

const AGENTS_DIR = resolve(homedir(), AGENT_STATE_BASE);

// ============================================================================
// Lock Management
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
      try {
        unlinkSync(lockPath);
      } catch {
        /* ignore */
      }
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

/**
 * Set up process-level signal handlers for lock cleanup.
 * Returns the cleanup function for manual use.
 */
export function setupLockCleanup(name: string): () => void {
  acquireLock(name);
  const cleanup = () => releaseLock(name);
  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });
  return cleanup;
}

// ============================================================================
// List Agents
// ============================================================================

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

export function listAgents(): void {
  const colors = createColors(process.stdout.isTTY ?? false);

  if (!existsSync(AGENTS_DIR)) {
    console.log(
      colors.dim('No agents found. Create one with: agntk --name "my-agent" "do something"'),
    );
    return;
  }

  const entries = readdirSync(AGENTS_DIR, { withFileTypes: true });
  const agents = entries.filter((e) => e.isDirectory());

  if (agents.length === 0) {
    console.log(
      colors.dim('No agents found. Create one with: agntk --name "my-agent" "do something"'),
    );
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
        } catch {
          /* skip */
        }
      }
    } catch {
      /* skip */
    }

    // Build output line
    const statusIcon = isRunning ? colors.green('●') : colors.dim('○');
    const nameStr = isRunning ? colors.green(colors.bold(agent.name)) : agent.name;
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
