import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { withRefineLoop, AgentRegistry } from '@agntk/core/advanced';
import type { AgentRegistryEntry, RefineLoopConfig } from '@agntk/core/advanced';
import { wrapAllToolsWithWorkspace, createProgressTools } from '@agntk/core/tools';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Creates a lightweight mock agent satisfying the Agent interface.
 * Uses an array of responses to simulate multi-turn behavior without
 * requiring createAgent + ToolLoopAgent (which has zod v4 compat issues
 * with the mock model in this env).
 */
function createMockAgent(responses: string[]) {
  let callIndex = 0;

  return {
    name: 'mock-agent',
    init: async () => {},
    getSystemPrompt: () => 'test prompt',
    getToolNames: () => [],
    getModelId: () => 'mock-model',
    stream: async (_input: { prompt: string }) => {
      const text = responses[callIndex] ?? responses[responses.length - 1];
      callIndex++;
      return {
        fullStream: (async function* () {
          yield { type: 'text-delta' as const, text };
        })(),
        text: Promise.resolve(text),
        usage: Promise.resolve({
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
        }),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// 1. Refine Loop
// ---------------------------------------------------------------------------
describe('Refine Loop', () => {
  it('should run withRefineLoop and return a result with history', async () => {
    const agent = createMockAgent(['A well-crafted response about software design.']);

    const config: RefineLoopConfig = {
      criteria: 'Clarity and completeness',
      threshold: 0.5,
      maxIterations: 2,
      evaluator: async (_output: string) => ({
        score: 0.8,
        critique: 'Good output',
        strengths: ['Clear'],
        weaknesses: [],
      }),
    };

    const result = await withRefineLoop(agent, 'Explain SOLID principles', config);

    expect(result.text).toBeDefined();
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.score).toBe(0.8);
    expect(result.thresholdMet).toBe(true);
    expect(result.iterations).toBe(1);
    expect(result.history).toHaveLength(1);
    expect(result.history[0].score).toBe(0.8);
    expect(result.history[0].critique).toBe('Good output');
    expect(result.history[0].strengths).toEqual(['Clear']);
    expect(result.usage).toBeDefined();
    expect(result.usage.inputTokens).toBeGreaterThan(0);
  });

  it('should iterate when score is below threshold', async () => {
    let callCount = 0;
    const agent = createMockAgent([
      'First attempt at the answer.',
      'Second improved attempt at the answer.',
      'Third polished attempt at the answer.',
    ]);

    const config: RefineLoopConfig = {
      criteria: 'Depth and accuracy',
      threshold: 0.9,
      maxIterations: 3,
      evaluator: async () => {
        callCount++;
        const score = callCount === 3 ? 0.95 : 0.4;
        return {
          score,
          critique: score < 0.9 ? 'Needs more depth' : 'Excellent',
          strengths: ['Attempt made'],
          weaknesses: score < 0.9 ? ['Lacks detail'] : [],
        };
      },
    };

    const result = await withRefineLoop(agent, 'Explain monads', config);

    expect(result.thresholdMet).toBe(true);
    expect(result.iterations).toBe(3);
    expect(result.history).toHaveLength(3);
    expect(result.score).toBe(0.95);
  });

  it('should return best attempt when max iterations reached without meeting threshold', async () => {
    const agent = createMockAgent(['Attempt one.', 'Attempt two.']);

    let callCount = 0;
    const config: RefineLoopConfig = {
      criteria: 'Perfection',
      threshold: 0.99,
      maxIterations: 2,
      evaluator: async () => {
        callCount++;
        return {
          score: callCount === 1 ? 0.3 : 0.6,
          critique: 'Not perfect yet',
          strengths: [],
          weaknesses: ['Needs perfection'],
        };
      },
    };

    const result = await withRefineLoop(agent, 'Write perfect code', config);

    expect(result.thresholdMet).toBe(false);
    expect(result.iterations).toBe(2);
    expect(result.score).toBe(0.6);
    expect(result.text).toBe('Attempt two.');
    expect(result.history).toHaveLength(2);
    expect(result.history[0].score).toBe(0.3);
    expect(result.history[1].score).toBe(0.6);
  });

  it('should accumulate usage across iterations', async () => {
    const agent = createMockAgent(['V1', 'V2']);

    let evalCount = 0;
    const config: RefineLoopConfig = {
      criteria: 'Quality',
      threshold: 0.7,
      maxIterations: 2,
      evaluator: async () => {
        evalCount++;
        return {
          score: evalCount === 2 ? 0.8 : 0.3,
          critique: 'Feedback',
        };
      },
    };

    const result = await withRefineLoop(agent, 'Test', config);

    expect(result.usage.inputTokens).toBe(20);
    expect(result.usage.outputTokens).toBe(40);
    expect(result.usage.totalTokens).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// 2. Workspace Middleware
// ---------------------------------------------------------------------------
describe('Workspace Middleware', () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), 'agntk-ws-integ-'));
  });

  afterEach(async () => {
    await rm(workspaceDir, { recursive: true, force: true });
  });

  function createTool(result: unknown) {
    return {
      description: 'test tool',
      execute: async () => result,
    };
  }

  function longString(length: number = 10000): string {
    const segment = 'Tool output line with data for testing workspace middleware offload. ';
    let output = '';
    while (output.length < length) {
      output += segment;
    }
    return output.slice(0, length);
  }

  it('should pass through small results without offloading', async () => {
    const tools = { search: createTool('short result') };
    const wrapped = wrapAllToolsWithWorkspace(tools, {
      getWorkspacePath: () => workspaceDir,
      tokenThreshold: 2000,
    });

    const result = await wrapped.search.execute!({});
    expect(result).toBe('short result');
  });

  it('should offload large string results to workspace file', async () => {
    const largeResult = longString(12000);
    const tools = { grep: createTool(largeResult) };
    const wrapped = wrapAllToolsWithWorkspace(tools, {
      getWorkspacePath: () => workspaceDir,
      tokenThreshold: 2000,
    });

    const result = await wrapped.grep.execute!({});
    const parsed = JSON.parse(result as string);

    expect(parsed._workspaceOffloaded).toBe(true);
    expect(parsed.savedTo).toContain(workspaceDir);
    expect(parsed.estimatedTokens).toBeGreaterThan(2000);
    expect(parsed.summary).toBeDefined();

    const fileContent = await readFile(parsed.savedTo, 'utf-8');
    expect(fileContent).toBe(largeResult);
  });

  it('should create nested workspace directories on demand', async () => {
    const nestedPath = join(workspaceDir, 'sub', 'deep');
    const largeResult = longString(10000);
    const tools = { search: createTool(largeResult) };
    const wrapped = wrapAllToolsWithWorkspace(tools, {
      getWorkspacePath: () => nestedPath,
      tokenThreshold: 2000,
    });

    const result = await wrapped.search.execute!({});
    const parsed = JSON.parse(result as string);

    expect(existsSync(parsed.savedTo)).toBe(true);
    expect(parsed.savedTo).toContain('sub');
  });

  it('should skip excluded tools even when result is large', async () => {
    const largeResult = longString(10000);
    const tools = {
      plan: createTool(largeResult),
      search: createTool(largeResult),
    };

    const wrapped = wrapAllToolsWithWorkspace(tools, {
      getWorkspacePath: () => workspaceDir,
      tokenThreshold: 2000,
    });

    const planResult = await wrapped.plan.execute!({});
    expect(planResult).toBe(largeResult);

    const searchResult = await wrapped.search.execute!({});
    const parsed = JSON.parse(searchResult as string);
    expect(parsed._workspaceOffloaded).toBe(true);
  });

  it('should pass through non-string results unchanged', async () => {
    const objectResult = { count: 42, items: ['a', 'b'] };
    const tools = { api: createTool(objectResult) };
    const wrapped = wrapAllToolsWithWorkspace(tools, {
      getWorkspacePath: () => workspaceDir,
      tokenThreshold: 2000,
    });

    const result = await wrapped.api.execute!({});
    expect(result).toEqual(objectResult);
  });

  it('should pass through when getWorkspacePath returns null', async () => {
    const largeResult = longString(10000);
    const tools = { search: createTool(largeResult) };
    const wrapped = wrapAllToolsWithWorkspace(tools, {
      getWorkspacePath: () => null,
      tokenThreshold: 2000,
    });

    const result = await wrapped.search.execute!({});
    expect(result).toBe(largeResult);
  });
});

// ---------------------------------------------------------------------------
// 3. Progress Tool
// ---------------------------------------------------------------------------
describe('Progress Tool', () => {
  let tmpDir: string;

  const callCtx = {
    toolCallId: 'test-integ',
    messages: [],
    abortSignal: undefined as unknown as AbortSignal,
  };

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'agntk-progress-integ-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should return valid tools with expected names', () => {
    const tools = createProgressTools(tmpDir);
    expect(tools.progress_read).toBeDefined();
    expect(tools.progress_update).toBeDefined();
    expect(tools.progress_read.execute).toBeTypeOf('function');
    expect(tools.progress_update.execute).toBeTypeOf('function');
  });

  it('should read empty progress when no file exists', async () => {
    const tools = createProgressTools(tmpDir);
    const raw = await tools.progress_read.execute({}, callCtx);
    const result = JSON.parse(raw as string);

    expect(result.success).toBe(true);
    expect(result.summary.totalFeatures).toBe(0);
    expect(result.data.features).toEqual([]);
    expect(result.data.sessions).toEqual([]);
  });

  it('should add a feature and read it back', async () => {
    const tools = createProgressTools(tmpDir);

    await tools.progress_update.execute(
      {
        featureId: 'auth',
        featureName: 'Authentication',
        featureStatus: 'in_progress',
        featureDescription: 'User login and registration',
      },
      callCtx,
    );

    const raw = await tools.progress_read.execute({}, callCtx);
    const result = JSON.parse(raw as string);

    expect(result.success).toBe(true);
    expect(result.summary.totalFeatures).toBe(1);
    expect(result.summary.inProgress).toBe(1);
    expect(result.data.features[0].id).toBe('auth');
    expect(result.data.features[0].name).toBe('Authentication');
    expect(result.data.features[0].status).toBe('in_progress');
  });

  it('should update a feature status', async () => {
    const tools = createProgressTools(tmpDir);

    await tools.progress_update.execute(
      { featureId: 'auth', featureName: 'Auth', featureStatus: 'pending' },
      callCtx,
    );
    await tools.progress_update.execute(
      { featureId: 'auth', featureStatus: 'completed', featureNotes: 'All tests pass' },
      callCtx,
    );

    const raw = await tools.progress_read.execute({}, callCtx);
    const result = JSON.parse(raw as string);

    expect(result.data.features[0].status).toBe('completed');
    expect(result.data.features[0].notes).toBe('All tests pass');
  });

  it('should log session actions', async () => {
    const tools = createProgressTools(tmpDir);

    await tools.progress_update.execute(
      { sessionId: 'session-integ-1', action: 'Started integration testing' },
      callCtx,
    );
    await tools.progress_update.execute(
      { sessionId: 'session-integ-1', action: 'Completed auth module' },
      callCtx,
    );

    const raw = await tools.progress_read.execute({}, callCtx);
    const result = JSON.parse(raw as string);

    expect(result.data.sessions).toHaveLength(1);
    expect(result.data.sessions[0].actions).toHaveLength(2);
    expect(result.data.sessions[0].actions[0]).toContain('Started integration testing');
    expect(result.data.sessions[0].actions[1]).toContain('Completed auth module');
  });

  it('should persist progress to disk as valid JSON', async () => {
    const tools = createProgressTools(tmpDir);

    await tools.progress_update.execute(
      { featureId: 'test-feat', featureName: 'Test', featureStatus: 'pending' },
      callCtx,
    );

    const filePath = join(tmpDir, 'progress.json');
    expect(existsSync(filePath)).toBe(true);

    const raw = await readFile(filePath, 'utf-8');
    const data = JSON.parse(raw);
    expect(data.version).toBe(1);
    expect(data.features).toHaveLength(1);
    expect(raw.endsWith('\n')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Agent Registry Persistence
// ---------------------------------------------------------------------------
describe('Agent Registry Persistence', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'agntk-registry-integ-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  function registryPath(): string {
    return join(tmpDir, 'registry.json');
  }

  function makeEntry(overrides: Partial<AgentRegistryEntry> = {}): AgentRegistryEntry {
    return {
      agentId: 'agent-001',
      task: 'Summarize the codebase',
      status: 'running',
      workspacePath: '/tmp/workspace',
      startedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it('should register an agent and retrieve it', async () => {
    const registry = new AgentRegistry();
    registry.setPersistPath(registryPath());

    const entry = makeEntry();
    await registry.register(entry);

    const retrieved = registry.get('agent-001');
    expect(retrieved).toBeDefined();
    expect(retrieved!.agentId).toBe('agent-001');
    expect(retrieved!.task).toBe('Summarize the codebase');
    expect(retrieved!.status).toBe('running');
  });

  it('should update an agent status', async () => {
    const registry = new AgentRegistry();
    registry.setPersistPath(registryPath());

    await registry.register(makeEntry());
    await registry.update('agent-001', {
      status: 'completed',
      summary: 'Done summarizing',
      completedAt: new Date().toISOString(),
    });

    const updated = registry.get('agent-001');
    expect(updated!.status).toBe('completed');
    expect(updated!.summary).toBe('Done summarizing');
    expect(updated!.completedAt).toBeDefined();
  });

  it('should persist to disk and load back', async () => {
    const path = registryPath();
    const registry = new AgentRegistry();
    registry.setPersistPath(path);

    await registry.register(makeEntry({ agentId: 'agent-a', task: 'Task A' }));
    await registry.register(makeEntry({ agentId: 'agent-b', task: 'Task B', status: 'completed' }));

    expect(existsSync(path)).toBe(true);

    const registry2 = new AgentRegistry();
    await registry2.loadFromDisk(path);

    const all = registry2.getAll();
    expect(all).toHaveLength(2);

    const agentA = registry2.get('agent-a');
    expect(agentA).toBeDefined();
    expect(agentA!.task).toBe('Task A');
    expect(agentA!.status).toBe('running');

    const agentB = registry2.get('agent-b');
    expect(agentB).toBeDefined();
    expect(agentB!.task).toBe('Task B');
    expect(agentB!.status).toBe('completed');
  });

  it('should filter agents by status', async () => {
    const registry = new AgentRegistry();
    registry.setPersistPath(registryPath());

    await registry.register(makeEntry({ agentId: 'r1', status: 'running' }));
    await registry.register(makeEntry({ agentId: 'c1', status: 'completed' }));
    await registry.register(makeEntry({ agentId: 'f1', status: 'failed', error: 'timeout' }));

    expect(registry.getAll('running')).toHaveLength(1);
    expect(registry.getAll('completed')).toHaveLength(1);
    expect(registry.getAll('failed')).toHaveLength(1);
  });

  it('should report hasRunning correctly', async () => {
    const registry = new AgentRegistry();
    registry.setPersistPath(registryPath());

    await registry.register(makeEntry({ agentId: 'c1', status: 'completed' }));
    expect(registry.hasRunning()).toBe(false);

    await registry.register(makeEntry({ agentId: 'r1', status: 'running' }));
    expect(registry.hasRunning()).toBe(true);
  });

  it('should return correct counts', async () => {
    const registry = new AgentRegistry();
    registry.setPersistPath(registryPath());

    await registry.register(makeEntry({ agentId: 'r1', status: 'running' }));
    await registry.register(makeEntry({ agentId: 'r2', status: 'running' }));
    await registry.register(makeEntry({ agentId: 'c1', status: 'completed' }));
    await registry.register(makeEntry({ agentId: 'f1', status: 'failed' }));

    const counts = registry.getCounts();
    expect(counts.running).toBe(2);
    expect(counts.completed).toBe(1);
    expect(counts.failed).toBe(1);
  });

  it('should handle loadFromDisk when file does not exist', async () => {
    const registry = new AgentRegistry();
    const nonExistentPath = join(tmpDir, 'nonexistent.json');

    await registry.loadFromDisk(nonExistentPath);

    expect(registry.getAll()).toHaveLength(0);
  });

  it('should persist data that survives a full round-trip', async () => {
    const path = registryPath();
    const registry1 = new AgentRegistry();
    registry1.setPersistPath(path);

    await registry1.register(
      makeEntry({
        agentId: 'round-trip',
        task: 'Round trip test',
        status: 'running',
        tokenUsage: { input: 100, output: 50 },
      }),
    );
    await registry1.update('round-trip', {
      status: 'completed',
      summary: 'Successfully completed',
      completedAt: '2026-01-01T00:00:00Z',
    });

    const rawContent = await readFile(path, 'utf-8');
    const parsed = JSON.parse(rawContent);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].status).toBe('completed');
    expect(parsed[0].tokenUsage).toEqual({ input: 100, output: 50 });

    const registry2 = new AgentRegistry();
    await registry2.loadFromDisk(path);

    const loaded = registry2.get('round-trip');
    expect(loaded).toBeDefined();
    expect(loaded!.status).toBe('completed');
    expect(loaded!.summary).toBe('Successfully completed');
    expect(loaded!.tokenUsage).toEqual({ input: 100, output: 50 });
    expect(loaded!.completedAt).toBe('2026-01-01T00:00:00Z');
  });
});
