import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@agntk/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  createCheckAgentTool,
  checkAgentParametersSchema,
  type CheckAgentResult,
} from '../tools/spawn-agent/check-agent';
import { AgentRegistry, type AgentRegistryEntry } from '../tools/spawn-agent/registry';

function makeEntry(overrides: Partial<AgentRegistryEntry> = {}): AgentRegistryEntry {
  return {
    agentId: 'test-agent-a1b2',
    task: 'Test task',
    status: 'running',
    workspacePath: '/workspace/test-agent-a1b2',
    startedAt: new Date(Date.now() - 5000).toISOString(), // 5 seconds ago
    ...overrides,
  };
}

describe('checkAgentParametersSchema', () => {
  it('should accept empty input (query all)', () => {
    const result = checkAgentParametersSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('should accept agentId', () => {
    const result = checkAgentParametersSchema.parse({ agentId: 'research-abc-1234' });
    expect(result.agentId).toBe('research-abc-1234');
  });

  it('should accept status filter', () => {
    const result = checkAgentParametersSchema.parse({ status: 'running' });
    expect(result.status).toBe('running');
  });

  it('should reject invalid status', () => {
    const result = checkAgentParametersSchema.safeParse({ status: 'invalid' });
    expect(result.success).toBe(false);
  });
});

describe('createCheckAgentTool', () => {
  it('should create a tool with description, schema, and execute', () => {
    const registry = new AgentRegistry();
    const tool = createCheckAgentTool({ registry });

    expect(tool).toHaveProperty('description');
    expect(tool).toHaveProperty('inputSchema');
    expect(tool).toHaveProperty('execute');
    expect(tool.description.length).toBeGreaterThan(20);
  });
});

describe('check_agent query all', () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry();
  });

  it('should return empty list when no agents', () => {
    const tool = createCheckAgentTool({ registry });
    const result = tool.execute({}) as CheckAgentResult;

    expect(result.agents).toHaveLength(0);
    expect(result.summary).toContain('No agents spawned');
  });

  it('should return all agents', async () => {
    await registry.register(makeEntry({ agentId: 'a1', status: 'running' }));
    await registry.register(makeEntry({ agentId: 'a2', status: 'completed' }));

    const tool = createCheckAgentTool({ registry });
    const result = tool.execute({}) as CheckAgentResult;

    expect(result.agents).toHaveLength(2);
  });

  it('should include summary with counts', async () => {
    await registry.register(makeEntry({ agentId: 'a1', status: 'running' }));
    await registry.register(makeEntry({ agentId: 'a2', status: 'completed' }));
    await registry.register(makeEntry({ agentId: 'a3', status: 'failed' }));

    const tool = createCheckAgentTool({ registry });
    const result = tool.execute({}) as CheckAgentResult;

    expect(result.summary).toContain('1 running');
    expect(result.summary).toContain('1 completed');
    expect(result.summary).toContain('1 failed');
  });
});

describe('check_agent query by agentId', () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry();
  });

  it('should return specific agent', async () => {
    await registry.register(makeEntry({ agentId: 'research-abc-1234', task: 'Research topic' }));

    const tool = createCheckAgentTool({ registry });
    const result = tool.execute({ agentId: 'research-abc-1234' }) as CheckAgentResult;

    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].agentId).toBe('research-abc-1234');
    expect(result.agents[0].task).toBe('Research topic');
  });

  it('should return empty when agent not found', () => {
    const tool = createCheckAgentTool({ registry });
    const result = tool.execute({ agentId: 'nonexistent' }) as CheckAgentResult;

    expect(result.agents).toHaveLength(0);
    expect(result.summary).toContain('No agent found');
  });

  it('should include duration', async () => {
    await registry.register(
      makeEntry({
        agentId: 'a1',
        startedAt: new Date(Date.now() - 15_000).toISOString(), // 15s ago
      }),
    );

    const tool = createCheckAgentTool({ registry });
    const result = tool.execute({ agentId: 'a1' }) as CheckAgentResult;

    expect(result.agents[0].duration).toBeDefined();
    expect(result.agents[0].duration).toMatch(/\d+s/);
  });

  it('should show completed duration from startedAt to completedAt', async () => {
    const startedAt = new Date(Date.now() - 60_000).toISOString();
    const completedAt = new Date(Date.now() - 30_000).toISOString();

    await registry.register(
      makeEntry({
        agentId: 'a1',
        status: 'completed',
        startedAt,
        completedAt,
      }),
    );

    const tool = createCheckAgentTool({ registry });
    const result = tool.execute({ agentId: 'a1' }) as CheckAgentResult;

    expect(result.agents[0].duration).toBe('30s');
  });
});

describe('check_agent filter by status', () => {
  let registry: AgentRegistry;

  beforeEach(async () => {
    registry = new AgentRegistry();
    await registry.register(makeEntry({ agentId: 'a1', status: 'running' }));
    await registry.register(makeEntry({ agentId: 'a2', status: 'running' }));
    await registry.register(makeEntry({ agentId: 'a3', status: 'completed' }));
    await registry.register(makeEntry({ agentId: 'a4', status: 'failed' }));
  });

  it('should filter running agents', () => {
    const tool = createCheckAgentTool({ registry });
    const result = tool.execute({ status: 'running' }) as CheckAgentResult;

    expect(result.agents).toHaveLength(2);
    expect(result.agents.every((a) => a.status === 'running')).toBe(true);
  });

  it('should filter completed agents', () => {
    const tool = createCheckAgentTool({ registry });
    const result = tool.execute({ status: 'completed' }) as CheckAgentResult;

    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].agentId).toBe('a3');
  });

  it('should filter failed agents', () => {
    const tool = createCheckAgentTool({ registry });
    const result = tool.execute({ status: 'failed' }) as CheckAgentResult;

    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].agentId).toBe('a4');
  });
});

describe('check_agent entry fields', () => {
  it('should include error info for failed agents', async () => {
    const registry = new AgentRegistry();
    await registry.register(
      makeEntry({
        agentId: 'a1',
        status: 'failed',
        error: 'Rate limit exceeded',
        errorType: 'api_error',
      }),
    );

    const tool = createCheckAgentTool({ registry });
    const result = tool.execute({ agentId: 'a1' }) as CheckAgentResult;

    expect(result.agents[0].error).toBe('Rate limit exceeded');
    expect(result.agents[0].errorType).toBe('api_error');
  });

  it('should include summary for completed agents', async () => {
    const registry = new AgentRegistry();
    await registry.register(
      makeEntry({
        agentId: 'a1',
        status: 'completed',
        summary: 'Found 12 benchmark results',
      }),
    );

    const tool = createCheckAgentTool({ registry });
    const result = tool.execute({ agentId: 'a1' }) as CheckAgentResult;

    expect(result.agents[0].summary).toBe('Found 12 benchmark results');
  });

  it('should include workspacePath', async () => {
    const registry = new AgentRegistry();
    await registry.register(
      makeEntry({
        agentId: 'a1',
        workspacePath: '/workspace/current/research-abc',
      }),
    );

    const tool = createCheckAgentTool({ registry });
    const result = tool.execute({ agentId: 'a1' }) as CheckAgentResult;

    expect(result.agents[0].workspacePath).toBe('/workspace/current/research-abc');
  });
});
