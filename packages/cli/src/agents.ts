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
  rmSync,
  lstatSync,
  readlinkSync,
} from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { createColors, type Colors } from './ui';

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
  const allDirs = entries.filter((e) => e.isDirectory());

  // Filter out sub-agent directories (name starts with another agent's name + "_")
  const parentNames = allDirs.map((d) => d.name);
  const agents = allDirs.filter(
    (d) => !parentNames.some((p) => p !== d.name && d.name.startsWith(`${p}_`)),
  );

  if (agents.length === 0) {
    console.log(
      colors.dim('No agents found. Create one with: agntk --name "my-agent" "do something"'),
    );
    return;
  }

  // Count sub-agents per parent for display
  const subAgentCounts = new Map<string, number>();
  for (const dir of allDirs) {
    if (!agents.some((a) => a.name === dir.name)) {
      // This is a sub-agent — find its parent
      const parent = agents.find((a) => dir.name.startsWith(`${a.name}_`));
      if (parent) {
        subAgentCounts.set(parent.name, (subAgentCounts.get(parent.name) ?? 0) + 1);
      }
    }
  }

  console.log(`\n${colors.bold(`Agents (${agents.length})`)}\n`);

  // Calculate max name length for alignment
  const maxNameLen = Math.max(...agents.map((a) => a.name.length));

  for (const agent of agents) {
    const agentDir = join(AGENTS_DIR, agent.name);
    const contextPath = join(agentDir, 'context.md');
    const memoryDir = join(agentDir, 'memory');
    // Detect both old format (memory.md file) and new format (memory/ directory)
    const hasMemory =
      existsSync(join(agentDir, 'memory.md')) ||
      (existsSync(memoryDir) && readdirSync(memoryDir).some((f) => f.endsWith('.md')));
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
    const subCount = subAgentCounts.get(agent.name);
    if (subCount) {
      parts.push(colors.dim(`${subCount} sub-agent${subCount > 1 ? 's' : ''}`));
    }

    console.log(`  ${statusIcon} ${nameStr}${padding}${parts.join(colors.dim('  ·  '))}`);
  }
  console.log('');
}

// ============================================================================
// Helpers
// ============================================================================

/** Format bytes as human-readable string */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Recursively compute total size of a directory */
function getDirSize(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      try {
        if (entry.isDirectory()) {
          total += getDirSize(fullPath);
        } else if (entry.isFile()) {
          total += statSync(fullPath).size;
        }
      } catch {
        /* skip inaccessible */
      }
    }
  } catch {
    /* skip */
  }
  return total;
}

/** Resolve an agent name to its directory, supporting both exact and sanitized matching */
function resolveAgentDir(name: string): string | null {
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  const direct = join(AGENTS_DIR, safeName);
  if (existsSync(direct)) return direct;

  // Try exact name match (in case the dir name wasn't sanitized)
  const exact = join(AGENTS_DIR, name);
  if (existsSync(exact)) return exact;

  return null;
}

/** Get the directory name (last segment) from a full agent dir path */
function agentDirName(agentDir: string): string {
  return agentDir.split('/').pop()!;
}

/** Format token count (e.g. 12400 -> "12.4k") */
function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Prompt user for a yes/no confirmation */
function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

/** Prompt user for free-form input */
function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ============================================================================
// Info
// ============================================================================

interface RegistryEntry {
  agentId: string;
  task: string;
  status: string;
  workspacePath: string;
  startedAt: string;
  completedAt?: string;
  summary?: string;
  error?: string;
  tokenUsage?: { input: number; output: number };
}

function printDirContents(
  dir: string,
  label: string,
  colors: Colors,
  indent: string = '  ',
): { fileCount: number; totalSize: number } {
  if (!existsSync(dir)) return { fileCount: 0, totalSize: 0 };

  const entries = readdirSync(dir, { withFileTypes: true });
  const items = entries.filter((e) => e.name !== 'current' && !e.name.startsWith('.'));
  if (items.length === 0) return { fileCount: 0, totalSize: 0 };

  let totalSize = 0;
  const lines: string[] = [];

  for (const entry of items) {
    const fullPath = join(dir, entry.name);
    if (entry.isFile()) {
      const st = statSync(fullPath);
      totalSize += st.size;
      lines.push(
        `${indent}  ${entry.name}` +
          `  ${colors.dim(formatBytes(st.size))}  ${colors.dim('·')}  ${colors.dim(relativeTime(st.mtime))}`,
      );
    } else if (entry.isDirectory()) {
      const size = getDirSize(fullPath);
      totalSize += size;
      lines.push(`${indent}  ${entry.name}/` + `  ${colors.dim(formatBytes(size))}`);
    }
  }

  const totalLabel = items.length === 1 ? '1 file' : `${items.length} files`;
  console.log(
    `\n${indent}${colors.bold(label)} ${colors.dim(`(${totalLabel}, ${formatBytes(totalSize)})`)}`,
  );
  for (const line of lines) {
    console.log(line);
  }

  return { fileCount: items.length, totalSize };
}

export function agentInfo(name: string): void {
  const colors = createColors(process.stdout.isTTY ?? false);
  const agentDir = resolveAgentDir(name);

  if (!agentDir) {
    console.error(`Agent "${name}" not found.`);
    console.error(colors.dim(`  Agents are stored at: ${AGENTS_DIR}`));
    process.exit(1);
  }

  const dirName = agentDirName(agentDir);
  const lockInfo = getAgentLockInfo(agentDir);
  const isRunning = lockInfo !== null;

  // Last active
  let lastActive: Date | null = null;
  try {
    const files = readdirSync(agentDir);
    for (const f of files) {
      if (f === '.lock') continue;
      try {
        const st = statSync(join(agentDir, f));
        if (!lastActive || st.mtime > lastActive) lastActive = st.mtime;
      } catch {
        /* skip */
      }
    }
  } catch {
    /* skip */
  }

  // Header
  console.log('');
  console.log(`  ${colors.bold('Agent:')} ${dirName}`);

  const statusStr = isRunning
    ? `${colors.green('running')} ${colors.dim(`(pid ${lockInfo!.pid})`)}`
    : colors.dim('idle');
  const activeStr = lastActive
    ? `  ${colors.dim('·')}  last active ${relativeTime(lastActive)}`
    : '';
  console.log(`  ${colors.bold('Status:')} ${statusStr}${activeStr}`);
  console.log(`  ${colors.bold('Path:')}   ${colors.dim(agentDir)}`);

  // Root-level files (legacy memory.md, context.md, etc.)
  const rootFiles = readdirSync(agentDir, { withFileTypes: true }).filter(
    (e) => e.isFile() && !e.name.startsWith('.'),
  );
  if (rootFiles.length > 0) {
    console.log(`\n  ${colors.bold('Files')}`);
    for (const f of rootFiles) {
      const st = statSync(join(agentDir, f.name));
      console.log(
        `    ${f.name}  ${colors.dim(formatBytes(st.size))}  ${colors.dim('·')}  ${colors.dim(relativeTime(st.mtime))}`,
      );
    }
  }

  // Memory directory
  const memoryDir = join(agentDir, 'memory');
  printDirContents(memoryDir, 'Memory', colors);

  // Workspace
  const workspaceDir = join(agentDir, 'workspace');
  if (existsSync(workspaceDir)) {
    const currentLink = join(workspaceDir, 'current');
    let currentTarget: string | null = null;
    try {
      if (existsSync(currentLink) && lstatSync(currentLink).isSymbolicLink()) {
        currentTarget = readlinkSync(currentLink);
        // Show just the folder name, not full path
        const targetName = currentTarget.split('/').pop();
        console.log(`\n  ${colors.bold('Workspace')}`);
        console.log(`    current -> ${colors.cyan(targetName ?? currentTarget)}`);
      }
    } catch {
      /* skip */
    }

    // Show files in current workspace task folder
    if (currentTarget && existsSync(currentTarget)) {
      const wsEntries = readdirSync(currentTarget, { withFileTypes: true });
      const wsFiles = wsEntries.filter((e) => e.isFile() && !e.name.startsWith('.'));
      for (const f of wsFiles) {
        const st = statSync(join(currentTarget, f.name));
        console.log(`      ${f.name}  ${colors.dim(formatBytes(st.size))}`);
      }
    }

    // Count other workspace folders
    const wsDirs = readdirSync(workspaceDir, { withFileTypes: true }).filter(
      (e) => e.isDirectory() && e.name !== 'current',
    );
    if (wsDirs.length > 0 && !currentTarget) {
      const wsSize = getDirSize(workspaceDir);
      console.log(
        `\n  ${colors.bold('Workspace')} ${colors.dim(`(${wsDirs.length} folders, ${formatBytes(wsSize)})`)}`,
      );
    }
  }

  // Archive
  const archiveDir = join(agentDir, 'archive');
  if (existsSync(archiveDir)) {
    const archiveEntries = readdirSync(archiveDir, { withFileTypes: true }).filter((e) =>
      e.isDirectory(),
    );
    if (archiveEntries.length > 0) {
      console.log(
        `\n  ${colors.bold('Archive')} ${colors.dim(`(${archiveEntries.length} tasks)`)}`,
      );
      for (const entry of archiveEntries) {
        const size = getDirSize(join(archiveDir, entry.name));
        const st = statSync(join(archiveDir, entry.name));
        console.log(
          `    ${entry.name}/  ${colors.dim(formatBytes(size))}  ${colors.dim('·')}  ${colors.dim(relativeTime(st.mtime))}`,
        );
      }
    }
  }

  // Registry — sub-agent token usage
  const registryPath = join(agentDir, 'registry.json');
  let registryEntries: RegistryEntry[] = [];
  if (existsSync(registryPath)) {
    try {
      registryEntries = JSON.parse(readFileSync(registryPath, 'utf-8'));
    } catch {
      /* skip */
    }
  }

  // Sub-agents — detect by name prefix in AGENTS_DIR
  if (existsSync(AGENTS_DIR)) {
    const allDirs = readdirSync(AGENTS_DIR, { withFileTypes: true }).filter(
      (e) => e.isDirectory() && e.name.startsWith(`${dirName}_`) && e.name !== dirName,
    );

    if (allDirs.length > 0) {
      const hasTokens = registryEntries.some((e) => e.tokenUsage);
      const header = hasTokens
        ? `  ${colors.bold('Sub-agents')} ${colors.dim(`(${allDirs.length})`)}` +
          `${' '.repeat(50)}${colors.dim('tokens (in/out)')}`
        : `  ${colors.bold('Sub-agents')} ${colors.dim(`(${allDirs.length})`)}`;
      console.log(`\n${header}`);

      let totalInput = 0;
      let totalOutput = 0;

      for (const sub of allDirs) {
        const subDir = join(AGENTS_DIR, sub.name);
        const subLock = getAgentLockInfo(subDir);
        const subStatus = subLock ? colors.green('running') : colors.dim('idle');

        // Find registry entry for this sub-agent
        const regEntry = registryEntries.find((e) =>
          e.agentId.includes(sub.name.slice(dirName.length + 1)),
        );

        // Truncate long sub-agent names
        const displayName = sub.name.length > 50 ? sub.name.slice(0, 47) + '...' : sub.name;

        let line = `    ${displayName}  ${subStatus}`;

        if (regEntry?.tokenUsage) {
          totalInput += regEntry.tokenUsage.input;
          totalOutput += regEntry.tokenUsage.output;
          const padLen = Math.max(2, 65 - displayName.length);
          line += `${' '.repeat(padLen)}${formatTokens(regEntry.tokenUsage.input)} / ${formatTokens(regEntry.tokenUsage.output)}`;
        }

        console.log(line);
      }

      if (totalInput > 0) {
        console.log(
          `\n  ${colors.bold('Total tokens:')} ${formatTokens(totalInput)} in / ${formatTokens(totalOutput)} out`,
        );
      }
    }
  }

  // Total disk usage
  const totalDisk = getDirSize(agentDir);
  console.log(`\n  ${colors.bold('Disk:')} ${formatBytes(totalDisk)}`);
  console.log('');
}

// ============================================================================
// Delete
// ============================================================================

export async function deleteAgent(name: string): Promise<void> {
  const colors = createColors(process.stdout.isTTY ?? false);
  const agentDir = resolveAgentDir(name);

  if (!agentDir) {
    console.error(`Agent "${name}" not found.`);
    process.exit(1);
  }

  const dirName = agentDirName(agentDir);
  const lockInfo = getAgentLockInfo(agentDir);

  if (lockInfo) {
    console.error(
      `Agent "${dirName}" is running (pid ${lockInfo.pid}). Stop it first: agntk stop ${dirName}`,
    );
    process.exit(1);
  }

  const size = getDirSize(agentDir);
  const ok = await confirm(
    `Delete agent "${dirName}"? (${formatBytes(size)}) ${colors.dim('(y/N)')} `,
  );

  if (!ok) {
    console.log('Cancelled.');
    return;
  }

  rmSync(agentDir, { recursive: true, force: true });

  // Also clean up sub-agent directories
  if (existsSync(AGENTS_DIR)) {
    const subDirs = readdirSync(AGENTS_DIR, { withFileTypes: true }).filter(
      (e) => e.isDirectory() && e.name.startsWith(`${dirName}_`),
    );
    for (const sub of subDirs) {
      rmSync(join(AGENTS_DIR, sub.name), { recursive: true, force: true });
    }
    if (subDirs.length > 0) {
      console.log(
        `${colors.green('Deleted')} ${dirName} ${colors.dim(`(+ ${subDirs.length} sub-agent${subDirs.length > 1 ? 's' : ''})`)}`,
      );
    } else {
      console.log(`${colors.green('Deleted')} ${dirName}`);
    }
  } else {
    console.log(`${colors.green('Deleted')} ${dirName}`);
  }
}

// ============================================================================
// Stop
// ============================================================================

export function stopAgent(name: string): void {
  const colors = createColors(process.stdout.isTTY ?? false);
  const agentDir = resolveAgentDir(name);

  if (!agentDir) {
    console.error(`Agent "${name}" not found.`);
    process.exit(1);
  }

  const dirName = agentDirName(agentDir);
  const lockInfo = getAgentLockInfo(agentDir);

  if (!lockInfo) {
    console.log(`Agent "${dirName}" is not running.`);
    return;
  }

  const { pid } = lockInfo;

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Process may have already exited
  }

  // Wait briefly and check if still alive
  const deadline = Date.now() + 500;
  let stillAlive = true;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) {
      stillAlive = false;
      break;
    }
  }

  if (stillAlive) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }

  // Clean up lock file
  const lockPath = join(agentDir, '.lock');
  try {
    unlinkSync(lockPath);
  } catch {
    /* already cleaned */
  }

  console.log(`${colors.green('Stopped')} ${dirName} ${colors.dim(`(pid ${pid})`)}`);
}

// ============================================================================
// Clean
// ============================================================================

export async function cleanAgents(): Promise<void> {
  const colors = createColors(process.stdout.isTTY ?? false);

  if (!existsSync(AGENTS_DIR)) {
    console.log(colors.dim('No agents found.'));
    return;
  }

  const entries = readdirSync(AGENTS_DIR, { withFileTypes: true });
  const allDirs = entries.filter((e) => e.isDirectory());

  // Filter out sub-agent directories (name starts with another agent's name + "_")
  const dirNames = allDirs.map((d) => d.name);
  const agents = allDirs.filter(
    (d) => !dirNames.some((p) => p !== d.name && d.name.startsWith(`${p}_`)),
  );

  if (agents.length === 0) {
    console.log(colors.dim('No agents found.'));
    return;
  }

  // Gather info for each agent
  interface AgentEntry {
    name: string;
    dir: string;
    isRunning: boolean;
    pid?: number;
    lastActive: Date | null;
    size: number;
  }

  const agentEntries: AgentEntry[] = [];

  for (const agent of agents) {
    const agentDir = join(AGENTS_DIR, agent.name);
    const lockInfo = getAgentLockInfo(agentDir);

    let lastActive: Date | null = null;
    try {
      const files = readdirSync(agentDir);
      for (const f of files) {
        if (f === '.lock') continue;
        try {
          const st = statSync(join(agentDir, f));
          if (!lastActive || st.mtime > lastActive) lastActive = st.mtime;
        } catch {
          /* skip */
        }
      }
    } catch {
      /* skip */
    }

    agentEntries.push({
      name: agent.name,
      dir: agentDir,
      isRunning: lockInfo !== null,
      pid: lockInfo?.pid,
      lastActive,
      size: getDirSize(agentDir),
    });
  }

  // Display numbered list
  console.log(`\n${colors.bold(`Agents (${agentEntries.length})`)}\n`);

  const maxNameLen = Math.max(...agentEntries.map((a) => a.name.length));
  const maxIdxLen = String(agentEntries.length).length;

  for (let i = 0; i < agentEntries.length; i++) {
    const a = agentEntries[i]!;
    const idx = colors.dim(`${String(i + 1).padStart(maxIdxLen)}.`);
    const icon = a.isRunning ? colors.green('●') : colors.dim('○');
    const nameStr = a.isRunning ? colors.green(a.name) : a.name;
    const padding = ' '.repeat(maxNameLen - a.name.length + 2);

    const parts: string[] = [];
    if (a.isRunning) {
      parts.push(colors.green('running'));
    } else {
      parts.push(colors.dim('idle'));
    }
    if (a.lastActive) {
      parts.push(colors.dim(relativeTime(a.lastActive)));
    }
    parts.push(colors.dim(formatBytes(a.size)));

    console.log(`  ${idx} ${icon} ${nameStr}${padding}${parts.join(colors.dim('  ·  '))}`);
  }

  console.log('');
  const input = await prompt(
    `  Enter numbers to delete ${colors.dim('(comma-separated, ranges like 1-5, or "all idle")')}: `,
  );

  if (!input) {
    console.log('Cancelled.');
    return;
  }

  // Parse selection
  let selected: number[] = [];

  if (input.toLowerCase() === 'all idle') {
    selected = agentEntries.map((a, i) => (a.isRunning ? -1 : i)).filter((i) => i >= 0);
  } else {
    // Parse comma-separated numbers and ranges
    for (const part of input.split(',')) {
      const trimmed = part.trim();
      const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1]!, 10);
        const end = parseInt(rangeMatch[2]!, 10);
        for (let n = start; n <= end; n++) {
          if (n >= 1 && n <= agentEntries.length) selected.push(n - 1);
        }
      } else {
        const n = parseInt(trimmed, 10);
        if (n >= 1 && n <= agentEntries.length) selected.push(n - 1);
      }
    }
  }

  // Deduplicate
  selected = [...new Set(selected)];

  if (selected.length === 0) {
    console.log('No agents selected.');
    return;
  }

  // Filter out running agents
  const runningSkips = selected.filter((i) => agentEntries[i]!.isRunning);
  const toDelete = selected.filter((i) => !agentEntries[i]!.isRunning);

  if (runningSkips.length > 0) {
    console.log(colors.yellow(`  Skipping ${runningSkips.length} running agent(s)`));
  }

  if (toDelete.length === 0) {
    console.log('No idle agents to delete.');
    return;
  }

  const totalSize = toDelete.reduce((sum, i) => sum + agentEntries[i]!.size, 0);
  const ok = await confirm(
    `  Delete ${toDelete.length} agent(s)? (${formatBytes(totalSize)}) ${colors.dim('(y/N)')} `,
  );

  if (!ok) {
    console.log('Cancelled.');
    return;
  }

  for (const i of toDelete) {
    const a = agentEntries[i]!;
    rmSync(a.dir, { recursive: true, force: true });
    console.log(`  ${colors.green('Deleted')} ${a.name}`);
  }

  console.log(`\n  ${colors.green(`Removed ${toDelete.length} agent(s)`)}`);
}
