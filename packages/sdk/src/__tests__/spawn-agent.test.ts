import { describe, it, expect, vi } from 'vitest';
import {
  createSpawnAgentTool,
  spawnAgentParametersSchema,
  generateAgentId,
  type SpawnAgentSyncResult,
  type SpawnAgentAsyncResult,
  type SubAgentStreamData,
} from '../tools/spawn-agent';
import { AgentRegistry } from '../tools/spawn-agent/registry';

vi.mock('../models', () => ({
  resolveModel: () => ({
    modelId: 'mock-model',
    model: {
      provider: 'mock',
      specificationVersion: 'v1',
    },
  }),
}));

vi.mock('ai', () => ({
  generateId: () => 'mock-id-1234',
  generateText: vi.fn().mockResolvedValue({ text: 'Mock summary' }),
}));

vi.mock('@agntk/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function createMockAgentFactory(response = 'Hello World', shouldFail = false) {
  return vi.fn().mockReturnValue({
    stream: (_opts: { prompt: string }) => {
      if (shouldFail) {
        const rejectedPromise = Promise.resolve('').then(() => {
          throw new Error('Stream failed');
        });
        rejectedPromise.catch(() => {});

        return {
          // eslint-disable-next-line require-yield
          fullStream: (async function* () {
            throw new Error('Stream failed');
          })(),
          text: rejectedPromise,
          usage: rejectedPromise,
        };
      }

      return {
        fullStream: (async function* () {
          yield { type: 'text-delta', text: response };
        })(),
        text: Promise.resolve(response),
        usage: Promise.resolve({ totalTokens: 100, promptTokens: 50, completionTokens: 50 }),
      };
    },
  });
}

describe('spawnAgentParametersSchema', () => {
  it('should validate valid input with task only', () => {
    const result = spawnAgentParametersSchema.safeParse({
      task: 'Research ClickHouse benchmarks',
    });
    expect(result.success).toBe(true);
  });

  it('should require task field', () => {
    const result = spawnAgentParametersSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should default async to false', () => {
    const result = spawnAgentParametersSchema.parse({ task: 'Do something' });
    expect(result.async).toBe(false);
  });

  it('should accept optional context', () => {
    const result = spawnAgentParametersSchema.parse({
      task: 'Analyze logs',
      context: 'The auth service has been slow lately',
    });
    expect(result.context).toBe('The auth service has been slow lately');
  });

  it('should accept model tier', () => {
    const result = spawnAgentParametersSchema.parse({
      task: 'Quick lookup',
      model: 'fast',
    });
    expect(result.model).toBe('fast');
  });

  it('should reject invalid model tier', () => {
    const result = spawnAgentParametersSchema.safeParse({
      task: 'Task',
      model: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('should accept async: true', () => {
    const result = spawnAgentParametersSchema.parse({
      task: 'Background research',
      async: true,
    });
    expect(result.async).toBe(true);
  });
});

describe('generateAgentId', () => {
  it('should generate slug from task description', () => {
    const id = generateAgentId('Research ClickHouse benchmarks');
    expect(id).toMatch(/^research-clickhouse-benchmarks-/);
  });

  it('should take at most 3 words', () => {
    const id = generateAgentId('Analyze the auth service logs for errors');
    const parts = id.split('-');

    expect(parts.length).toBeLessThanOrEqual(5);
  });

  it('should handle special characters', () => {
    const id = generateAgentId('Fix bug #123 in auth.ts!');
    expect(id).not.toContain('#');
    expect(id).not.toContain('!');
    expect(id).not.toContain('.');
  });

  it('should handle empty task', () => {
    const id = generateAgentId('');
    expect(id).toMatch(/^agent-/);
  });

  it('should produce lowercase IDs', () => {
    const id = generateAgentId('RESEARCH CLICKHOUSE');
    expect(id).toBe(id.toLowerCase());
  });
});

describe('createSpawnAgentTool', () => {
  it('should create a tool with description, schema, and execute', () => {
    const tool = createSpawnAgentTool();
    expect(tool).toHaveProperty('description');
    expect(tool).toHaveProperty('inputSchema');
    expect(tool).toHaveProperty('execute');
    expect(typeof tool.description).toBe('string');
    expect(tool.description.length).toBeGreaterThan(50);
  });

  it('should return error when no agent factory provided', async () => {
    const tool = createSpawnAgentTool();
    const result = (await tool.execute({
      task: 'Test task',
    })) as SpawnAgentSyncResult;

    expect(result.success).toBe(false);
    expect(result.error).toContain('Agent factory not configured');
  });

  it('should return error when max depth exceeded', async () => {
    const tool = createSpawnAgentTool({
      maxSpawnDepth: 1,
      currentDepth: 1,
      createAgent: createMockAgentFactory(),
    });

    const result = (await tool.execute({
      task: 'Test task',
    })) as SpawnAgentSyncResult;

    expect(result.success).toBe(false);
    expect(result.errorType).toBe('depth_exceeded');
  });
});

describe('spawn_agent sync execution', () => {
  it('should call createAgent with task and instructions', async () => {
    const mockFactory = createMockAgentFactory('Done');
    const tool = createSpawnAgentTool({
      maxSpawnDepth: 2,
      currentDepth: 0,
      createAgent: mockFactory,
    });

    await tool.execute({ task: 'Write unit tests' });

    expect(mockFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'Write unit tests',
        instructions: expect.any(String),
        workspacePath: expect.any(String),
      }),
    );
  });

  it('should return success with agentId and summary', async () => {
    const tool = createSpawnAgentTool({
      createAgent: createMockAgentFactory('Task completed successfully'),
    });

    const result = (await tool.execute({
      task: 'Write unit tests',
    })) as SpawnAgentSyncResult;

    expect(result.success).toBe(true);
    expect(result.agentId).toBeDefined();
    expect(result.agentId.length).toBeGreaterThan(0);
    expect(result.workspacePath).toBeDefined();
  });

  it('should include context in prompt when provided', async () => {
    let capturedPrompt = '';
    const mockFactory = vi.fn().mockReturnValue({
      stream: (opts: { prompt: string }) => {
        capturedPrompt = opts.prompt;
        return {
          fullStream: (async function* () {})(),
          text: Promise.resolve('Done'),
          usage: Promise.resolve({ totalTokens: 10 }),
        };
      },
    });

    const tool = createSpawnAgentTool({ createAgent: mockFactory });
    await tool.execute({
      task: 'Analyze the problem',
      context: 'The database is slow',
    });

    expect(capturedPrompt).toContain('Context:');
    expect(capturedPrompt).toContain('The database is slow');
    expect(capturedPrompt).toContain('Analyze the problem');
  });

  it('should stream output via onStream callback', async () => {
    const streamedData: SubAgentStreamData[] = [];

    const tool = createSpawnAgentTool({
      createAgent: createMockAgentFactory('Hello World'),
      onStream: (data) => streamedData.push(data),
    });

    await tool.execute({ task: 'Test' });

    expect(streamedData.length).toBeGreaterThanOrEqual(2);
    expect(streamedData[0].status).toBe('streaming');
    expect(streamedData[streamedData.length - 1].status).toBe('complete');
  });

  it('should handle errors gracefully', async () => {
    const tool = createSpawnAgentTool({
      createAgent: createMockAgentFactory('', true),
    });

    const result = (await tool.execute({
      task: 'Doomed task',
    })) as SpawnAgentSyncResult;

    expect(result.success).toBe(false);
    expect(result.error).toContain('Stream failed');
    expect(result.errorType).toBe('task_failed');
  });
});

describe('spawn_agent registry integration', () => {
  it('should register agent in registry on spawn', async () => {
    const registry = new AgentRegistry();

    let registeredStatus: string | undefined;
    const origRegister = registry.register.bind(registry);
    vi.spyOn(registry, 'register').mockImplementation(async (entry) => {
      registeredStatus = entry.status;
      return origRegister(entry);
    });

    const tool = createSpawnAgentTool({
      createAgent: createMockAgentFactory('Done'),
      registry,
    });

    await tool.execute({ task: 'Test registration' });

    expect(registeredStatus).toBe('running');
  });

  it('should update registry to completed on success', async () => {
    const registry = new AgentRegistry();
    const updateSpy = vi.spyOn(registry, 'update');

    const tool = createSpawnAgentTool({
      createAgent: createMockAgentFactory('Done'),
      registry,
    });

    await tool.execute({ task: 'Test completion' });

    expect(updateSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'completed' }),
    );
  });

  it('should update registry to failed on error', async () => {
    const registry = new AgentRegistry();
    const updateSpy = vi.spyOn(registry, 'update');

    const tool = createSpawnAgentTool({
      createAgent: createMockAgentFactory('', true),
      registry,
    });

    await tool.execute({ task: 'Failing task' });

    expect(updateSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        status: 'failed',
        error: expect.any(String),
        errorType: expect.any(String),
      }),
    );
  });
});

describe('spawn_agent async execution', () => {
  it('should return immediately with status: running', async () => {
    const tool = createSpawnAgentTool({
      createAgent: createMockAgentFactory('Background result'),
      registry: new AgentRegistry(),
    });

    const result = (await tool.execute({
      task: 'Background research',
      async: true,
    })) as SpawnAgentAsyncResult;

    expect(result.success).toBe(true);
    expect(result.status).toBe('running');
    expect(result.agentId).toBeDefined();
    expect(result.workspacePath).toBeDefined();
    expect(result.message).toContain('background');
  });

  it('should register in registry as running', async () => {
    const registry = new AgentRegistry();

    const tool = createSpawnAgentTool({
      createAgent: createMockAgentFactory('Background result'),
      registry,
    });

    const result = (await tool.execute({
      task: 'Background task',
      async: true,
    })) as SpawnAgentAsyncResult;

    const entry = registry.get(result.agentId);
    expect(entry).toBeDefined();
    expect(entry!.status).toBe('running');
  });

  it('should eventually complete in background', async () => {
    const registry = new AgentRegistry();

    const tool = createSpawnAgentTool({
      createAgent: createMockAgentFactory('Background done'),
      registry,
    });

    const result = (await tool.execute({
      task: 'Async task',
      async: true,
    })) as SpawnAgentAsyncResult;

    await new Promise((r) => setTimeout(r, 100));

    const entry = registry.get(result.agentId);
    expect(entry).toBeDefined();
    expect(entry!.status).toBe('completed');
  });
});
