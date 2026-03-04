/**
 * @fileoverview Tests for the AgentRegistry.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFs: Record<string, string> = {};

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(async (path: string, data: string) => {
    mockFs[path] = data;
  }),
  readFile: vi.fn(async (path: string) => {
    if (!(path in mockFs)) throw new Error(`ENOENT: ${path}`);
    return mockFs[path];
  }),
  mkdir: vi.fn(async () => {}),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn((path: string) => path in mockFs),
}));

vi.mock('@agntk/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { AgentRegistry, type AgentRegistryEntry } from '../tools/spawn-agent/registry';

function makeEntry(overrides: Partial<AgentRegistryEntry> = {}): AgentRegistryEntry {
  return {
    agentId: 'test-agent-a1b2',
    task: 'Test task',
    status: 'running',
    workspacePath: '/tmp/workspace/test-agent-a1b2',
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('AgentRegistry', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockFs)) {
      delete mockFs[key];
    }
    vi.clearAllMocks();
  });

  describe('register', () => {
    it('should register a new agent', async () => {
      const registry = new AgentRegistry();
      const entry = makeEntry();

      await registry.register(entry);

      expect(registry.get(entry.agentId)).toEqual(entry);
    });

    it('should overwrite existing agent with same ID', async () => {
      const registry = new AgentRegistry();
      await registry.register(makeEntry({ task: 'First task' }));
      await registry.register(makeEntry({ task: 'Second task' }));

      expect(registry.get('test-agent-a1b2')!.task).toBe('Second task');
    });
  });

  describe('update', () => {
    it('should update agent status', async () => {
      const registry = new AgentRegistry();
      await registry.register(makeEntry());

      await registry.update('test-agent-a1b2', {
        status: 'completed',
        completedAt: new Date().toISOString(),
      });

      expect(registry.get('test-agent-a1b2')!.status).toBe('completed');
      expect(registry.get('test-agent-a1b2')!.completedAt).toBeDefined();
    });

    it('should update summary and token usage', async () => {
      const registry = new AgentRegistry();
      await registry.register(makeEntry());

      await registry.update('test-agent-a1b2', {
        summary: 'Task completed successfully',
        tokenUsage: { input: 100, output: 200 },
      });

      expect(registry.get('test-agent-a1b2')!.summary).toBe('Task completed successfully');
      expect(registry.get('test-agent-a1b2')!.tokenUsage).toEqual({ input: 100, output: 200 });
    });

    it('should silently skip non-existent agents', async () => {
      const registry = new AgentRegistry();

      await registry.update('non-existent', { status: 'completed' });
    });

    it('should update error info on failure', async () => {
      const registry = new AgentRegistry();
      await registry.register(makeEntry());

      await registry.update('test-agent-a1b2', {
        status: 'failed',
        error: 'API timeout',
        errorType: 'timeout',
      });

      const entry = registry.get('test-agent-a1b2')!;
      expect(entry.status).toBe('failed');
      expect(entry.error).toBe('API timeout');
      expect(entry.errorType).toBe('timeout');
    });
  });

  describe('get', () => {
    it('should return entry for existing agent', async () => {
      const registry = new AgentRegistry();
      const entry = makeEntry();
      await registry.register(entry);

      expect(registry.get('test-agent-a1b2')).toEqual(entry);
    });

    it('should return undefined for non-existent agent', () => {
      const registry = new AgentRegistry();
      expect(registry.get('non-existent')).toBeUndefined();
    });
  });

  describe('getAll', () => {
    it('should return all agents', async () => {
      const registry = new AgentRegistry();
      await registry.register(makeEntry({ agentId: 'a1' }));
      await registry.register(makeEntry({ agentId: 'a2' }));
      await registry.register(makeEntry({ agentId: 'a3' }));

      expect(registry.getAll()).toHaveLength(3);
    });

    it('should filter by status', async () => {
      const registry = new AgentRegistry();
      await registry.register(makeEntry({ agentId: 'a1', status: 'running' }));
      await registry.register(makeEntry({ agentId: 'a2', status: 'completed' }));
      await registry.register(makeEntry({ agentId: 'a3', status: 'failed' }));

      expect(registry.getAll('running')).toHaveLength(1);
      expect(registry.getAll('completed')).toHaveLength(1);
      expect(registry.getAll('failed')).toHaveLength(1);
    });

    it('should return empty array when no agents match filter', async () => {
      const registry = new AgentRegistry();
      await registry.register(makeEntry({ status: 'running' }));

      expect(registry.getAll('completed')).toHaveLength(0);
    });
  });

  describe('hasRunning', () => {
    it('should return true when running agents exist', async () => {
      const registry = new AgentRegistry();
      await registry.register(makeEntry({ status: 'running' }));

      expect(registry.hasRunning()).toBe(true);
    });

    it('should return false when no running agents', async () => {
      const registry = new AgentRegistry();
      await registry.register(makeEntry({ status: 'completed' }));

      expect(registry.hasRunning()).toBe(false);
    });

    it('should return false when empty', () => {
      const registry = new AgentRegistry();
      expect(registry.hasRunning()).toBe(false);
    });
  });

  describe('getCounts', () => {
    it('should return counts by status', async () => {
      const registry = new AgentRegistry();
      await registry.register(makeEntry({ agentId: 'a1', status: 'running' }));
      await registry.register(makeEntry({ agentId: 'a2', status: 'running' }));
      await registry.register(makeEntry({ agentId: 'a3', status: 'completed' }));
      await registry.register(makeEntry({ agentId: 'a4', status: 'failed' }));

      expect(registry.getCounts()).toEqual({
        running: 2,
        completed: 1,
        failed: 1,
      });
    });

    it('should return all zeros when empty', () => {
      const registry = new AgentRegistry();
      expect(registry.getCounts()).toEqual({
        running: 0,
        completed: 0,
        failed: 0,
      });
    });
  });

  describe('persistence', () => {
    it('should persist to disk when persistPath is set', async () => {
      const registry = new AgentRegistry();
      registry.setPersistPath('/tmp/workspace/.agents.json');

      await registry.register(makeEntry());

      expect(mockFs['/tmp/workspace/.agents.json']).toBeDefined();
      const parsed = JSON.parse(mockFs['/tmp/workspace/.agents.json']);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].agentId).toBe('test-agent-a1b2');
    });

    it('should not persist when no persistPath set', async () => {
      const registry = new AgentRegistry();
      await registry.register(makeEntry());

      expect(Object.keys(mockFs)).toHaveLength(0);
    });

    it('should persist after update', async () => {
      const registry = new AgentRegistry();
      registry.setPersistPath('/tmp/workspace/.agents.json');

      await registry.register(makeEntry());
      await registry.update('test-agent-a1b2', { status: 'completed' });

      const parsed = JSON.parse(mockFs['/tmp/workspace/.agents.json']);
      expect(parsed[0].status).toBe('completed');
    });
  });

  describe('loadFromDisk', () => {
    it('should load registry from JSON file', async () => {
      const entries = [
        makeEntry({ agentId: 'a1', status: 'completed' }),
        makeEntry({ agentId: 'a2', status: 'failed' }),
      ];
      mockFs['/tmp/workspace/.agents.json'] = JSON.stringify(entries);

      const registry = new AgentRegistry();
      await registry.loadFromDisk('/tmp/workspace/.agents.json');

      expect(registry.getAll()).toHaveLength(2);
      expect(registry.get('a1')!.status).toBe('completed');
      expect(registry.get('a2')!.status).toBe('failed');
    });

    it('should handle missing file gracefully', async () => {
      const registry = new AgentRegistry();
      await registry.loadFromDisk('/tmp/nonexistent/.agents.json');

      expect(registry.getAll()).toHaveLength(0);
    });

    it('should handle malformed JSON gracefully', async () => {
      mockFs['/tmp/workspace/.agents.json'] = 'not json';

      const registry = new AgentRegistry();
      await registry.loadFromDisk('/tmp/workspace/.agents.json');

      expect(registry.getAll()).toHaveLength(0);
    });

    it('should set persistPath when loading', async () => {
      mockFs['/tmp/workspace/.agents.json'] = JSON.stringify([makeEntry()]);

      const registry = new AgentRegistry();
      await registry.loadFromDisk('/tmp/workspace/.agents.json');

      await registry.register(makeEntry({ agentId: 'new-agent' }));

      const parsed = JSON.parse(mockFs['/tmp/workspace/.agents.json']);
      expect(parsed).toHaveLength(2);
    });
  });
});
