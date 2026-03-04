import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRegistry, createCheckAgentTool } from '@agntk/core/advanced';
import type { CheckAgentResult } from '@agntk/core/advanced';

let registry: AgentRegistry;

beforeEach(() => {
  registry = new AgentRegistry();
});

const now = new Date().toISOString();

describe('AgentRegistry', () => {
  it('registers and retrieves an agent entry', async () => {
    await registry.register({
      agentId: 'agent-1',
      task: 'Write unit tests',
      status: 'running',
      workspacePath: '/tmp/agent-1',
      startedAt: now,
    });

    const entry = registry.get('agent-1');
    expect(entry).toBeDefined();
    expect(entry?.task).toBe('Write unit tests');
    expect(entry?.status).toBe('running');
  });

  it('lists all registered agents with getAll', async () => {
    await registry.register({
      agentId: 'agent-1',
      task: 'Task one',
      status: 'running',
      workspacePath: '/tmp/agent-1',
      startedAt: now,
    });
    await registry.register({
      agentId: 'agent-2',
      task: 'Task two',
      status: 'completed',
      workspacePath: '/tmp/agent-2',
      startedAt: now,
    });

    const entries = registry.getAll();
    expect(entries.length).toBe(2);
    expect(entries.some((e) => e.agentId === 'agent-1')).toBe(true);
    expect(entries.some((e) => e.agentId === 'agent-2')).toBe(true);
  });

  it('filters by status', async () => {
    await registry.register({
      agentId: 'agent-1',
      task: 'Running task',
      status: 'running',
      workspacePath: '/tmp/agent-1',
      startedAt: now,
    });
    await registry.register({
      agentId: 'agent-2',
      task: 'Done task',
      status: 'completed',
      workspacePath: '/tmp/agent-2',
      startedAt: now,
    });

    const running = registry.getAll('running');
    expect(running.length).toBe(1);
    expect(running[0].agentId).toBe('agent-1');
  });

  it('updates agent status', async () => {
    await registry.register({
      agentId: 'agent-1',
      task: 'Some task',
      status: 'running',
      workspacePath: '/tmp/agent-1',
      startedAt: now,
    });

    await registry.update('agent-1', { status: 'completed', summary: 'Success' });
    const entry = registry.get('agent-1');
    expect(entry?.status).toBe('completed');
    expect(entry?.summary).toBe('Success');
  });

  it('update on nonexistent agent is a no-op', async () => {
    await registry.update('nonexistent', { status: 'completed' });
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('getCounts returns correct counts', async () => {
    await registry.register({
      agentId: 'a1',
      task: 'T1',
      status: 'running',
      workspacePath: '/tmp/a1',
      startedAt: now,
    });
    await registry.register({
      agentId: 'a2',
      task: 'T2',
      status: 'completed',
      workspacePath: '/tmp/a2',
      startedAt: now,
    });
    await registry.register({
      agentId: 'a3',
      task: 'T3',
      status: 'failed',
      workspacePath: '/tmp/a3',
      startedAt: now,
    });

    const counts = registry.getCounts();
    expect(counts.running).toBe(1);
    expect(counts.completed).toBe(1);
    expect(counts.failed).toBe(1);
  });

  it('hasRunning detects running agents', async () => {
    expect(registry.hasRunning()).toBe(false);
    await registry.register({
      agentId: 'a1',
      task: 'T1',
      status: 'running',
      workspacePath: '/tmp/a1',
      startedAt: now,
    });
    expect(registry.hasRunning()).toBe(true);
    await registry.update('a1', { status: 'completed' });
    expect(registry.hasRunning()).toBe(false);
  });
});

describe('createCheckAgentTool', () => {
  it('returns empty list when no agents registered', () => {
    const checkTool = createCheckAgentTool({ registry });
    const result = checkTool.execute({}) as CheckAgentResult;
    expect(result.agents.length).toBe(0);
    expect(result.summary).toContain('No agents');
  });

  it('lists registered agents', async () => {
    await registry.register({
      agentId: 'sub-1',
      task: 'Build feature',
      status: 'running',
      workspacePath: '/tmp/sub-1',
      startedAt: now,
    });
    await registry.register({
      agentId: 'sub-2',
      task: 'Run tests',
      status: 'completed',
      workspacePath: '/tmp/sub-2',
      startedAt: now,
    });

    const checkTool = createCheckAgentTool({ registry });
    const result = checkTool.execute({}) as CheckAgentResult;
    expect(result.agents.length).toBe(2);
    expect(result.summary).toContain('2 agent');
  });

  it('checks specific agent by ID', async () => {
    await registry.register({
      agentId: 'sub-1',
      task: 'Long task',
      status: 'running',
      workspacePath: '/tmp/sub-1',
      startedAt: now,
    });

    const checkTool = createCheckAgentTool({ registry });
    const result = checkTool.execute({ agentId: 'sub-1' }) as CheckAgentResult;
    expect(result.agents.length).toBe(1);
    expect(result.agents[0].status).toBe('running');
    expect(result.summary).toContain('running');
  });

  it('returns empty for unknown agent ID', () => {
    const checkTool = createCheckAgentTool({ registry });
    const result = checkTool.execute({ agentId: 'nope' }) as CheckAgentResult;
    expect(result.agents.length).toBe(0);
    expect(result.summary).toContain('No agent found');
  });

  it('filters by status', async () => {
    await registry.register({
      agentId: 'a1',
      task: 'T1',
      status: 'running',
      workspacePath: '/tmp',
      startedAt: now,
    });
    await registry.register({
      agentId: 'a2',
      task: 'T2',
      status: 'completed',
      workspacePath: '/tmp',
      startedAt: now,
    });

    const checkTool = createCheckAgentTool({ registry });
    const result = checkTool.execute({ status: 'completed' }) as CheckAgentResult;
    expect(result.agents.length).toBe(1);
    expect(result.agents[0].agentId).toBe('a2');
  });
});
