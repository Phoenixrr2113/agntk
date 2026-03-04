/**
 * @fileoverview Sub-agent registry and persistence.
 * Tracks the status, task, and lifecycle of all spawned agents.
 * Provides methods for registering, updating, and persisting sub-agent metadata to disk.
 */

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { createLogger } from '@agntk/logger';

const log = createLogger('@agntk/core:agent-registry');

export type AgentStatus = 'running' | 'completed' | 'failed';

export type SpawnErrorType = 'timeout' | 'api_error' | 'depth_exceeded' | 'task_failed';

export interface AgentRegistryEntry {
  agentId: string;
  task: string;
  status: AgentStatus;
  workspacePath: string;
  startedAt: string;
  completedAt?: string;
  summary?: string;
  error?: string;
  errorType?: SpawnErrorType;
  tokenUsage?: { input: number; output: number };
}

export class AgentRegistry {
  private readonly agents = new Map<string, AgentRegistryEntry>();
  private persistPath: string | null = null;

  setPersistPath(path: string): void {
    this.persistPath = path;
  }

  async register(entry: AgentRegistryEntry): Promise<void> {
    this.agents.set(entry.agentId, entry);
    log.debug('Agent registered', { agentId: entry.agentId, task: entry.task.slice(0, 50) });
    await this.persist();
  }

  async update(agentId: string, updates: Partial<AgentRegistryEntry>): Promise<void> {
    const entry = this.agents.get(agentId);
    if (!entry) {
      log.warn('Attempted to update non-existent agent', { agentId });
      return;
    }

    Object.assign(entry, updates);
    log.debug('Agent updated', { agentId, status: entry.status });
    await this.persist();
  }

  get(agentId: string): AgentRegistryEntry | undefined {
    return this.agents.get(agentId);
  }

  getAll(statusFilter?: AgentStatus): AgentRegistryEntry[] {
    const entries = Array.from(this.agents.values());
    if (statusFilter) {
      return entries.filter((e) => e.status === statusFilter);
    }
    return entries;
  }

  hasRunning(): boolean {
    return Array.from(this.agents.values()).some((e) => e.status === 'running');
  }

  getCounts(): Record<AgentStatus, number> {
    const counts: Record<AgentStatus, number> = { running: 0, completed: 0, failed: 0 };
    for (const entry of this.agents.values()) {
      counts[entry.status]++;
    }
    return counts;
  }

  private async persist(): Promise<void> {
    if (!this.persistPath) return;

    try {
      const dir = dirname(this.persistPath);
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }

      const data = JSON.stringify(Array.from(this.agents.values()), null, 2);
      await writeFile(this.persistPath, data, 'utf-8');
    } catch (err) {
      log.warn('Registry persist failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async loadFromDisk(path: string): Promise<void> {
    this.persistPath = path;

    if (!existsSync(path)) return;

    try {
      const data = await readFile(path, 'utf-8');
      const entries: AgentRegistryEntry[] = JSON.parse(data);
      for (const entry of entries) {
        this.agents.set(entry.agentId, entry);
      }
      log.info('Registry loaded from disk', { count: entries.length, path });
    } catch (err) {
      log.warn('Registry load failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
