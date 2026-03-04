import { describe, it, expect, vi } from 'vitest';
import { MockLanguageModelV3, mockValues } from 'ai/test';
import type { LanguageModel } from 'ai';
import type { Agent } from '../types/agent';

vi.mock('@agntk/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    time: vi.fn(() => vi.fn()),
  }),
}));

import { withBestOfN } from '../wrappers/best-of-n';

function createMockAgent(outputs: string[]): Agent {
  let callIndex = 0;
  return {
    name: 'test-agent',
    init: vi.fn().mockResolvedValue(undefined),
    stream: vi.fn().mockImplementation(async () => {
      const idx = callIndex++;
      const text = outputs[idx % outputs.length];
      return {
        fullStream: (async function* () {})(),
        text: Promise.resolve(text),
        usage: Promise.resolve({ inputTokens: 100, outputTokens: 50, totalTokens: 150 }),
      };
    }),
    getSystemPrompt: () => 'test prompt',
    getToolNames: () => [],
    getModelId: () => 'mock-model',
  } as unknown as Agent;
}

function createMockJudge(...responses: string[]): LanguageModel {
  return new MockLanguageModelV3({
    doGenerate: mockValues(
      ...responses.map((text) => ({
        content: [{ type: 'text' as const, text }],
        finishReason: { unified: 'stop' as const, raw: 'stop' },
        usage: {
          inputTokens: { total: 10 },
          outputTokens: { total: 20, text: 20, reasoning: 0 },
        },
        warnings: [],
      })),
    ),
  }) as unknown as LanguageModel;
}

function createFailingJudge(): LanguageModel {
  return new MockLanguageModelV3({
    doGenerate: async () => {
      throw new Error('Judge unavailable');
    },
  }) as unknown as LanguageModel;
}

describe('withBestOfN', () => {
  it('should run agent N times and return candidates', async () => {
    const agent = createMockAgent(['output-1', 'output-2', 'output-3']);
    const judge = createMockJudge('2:9\n1:7\n3:5');

    const result = await withBestOfN(agent, 'Write something', {
      n: 3,
      judgeModel: judge,
      criteria: 'Quality and creativity',
    });

    expect(result.candidates).toHaveLength(3);
    expect(result.runsCompleted).toBe(3);
    expect(agent.stream).toHaveBeenCalledTimes(3);
  });

  it('should pick the best candidate based on judge scores', async () => {
    const agent = createMockAgent(['bad output', 'great output', 'ok output']);
    const judge = createMockJudge('1:3\n2:10\n3:6');

    const result = await withBestOfN(agent, 'Write something', {
      n: 3,
      judgeModel: judge,
      criteria: 'Quality',
    });

    expect(result.best.text).toBe('great output');
    expect(result.best.score).toBe(10);
    expect(result.best.index).toBe(1);
  });

  it('should return correct total usage', async () => {
    const agent = createMockAgent(['a', 'b']);
    const judge = createMockJudge('1:8\n2:5');

    const result = await withBestOfN(agent, 'test', {
      n: 2,
      judgeModel: judge,
      criteria: 'Quality',
    });

    expect(result.totalUsage.inputTokens).toBe(200);
    expect(result.totalUsage.outputTokens).toBe(100);
    expect(result.totalUsage.totalTokens).toBe(300);
  });

  it('should handle single candidate without judging', async () => {
    const agent = createMockAgent(['only output']);

    const judge = createMockJudge('1:10');

    const result = await withBestOfN(agent, 'test', {
      n: 1,
      judgeModel: judge,
      criteria: 'Quality',
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.best.text).toBe('only output');
    expect(result.best.score).toBe(1);
  });
});

describe('list-wise strategy', () => {
  it('should rank all outputs in a single call', async () => {
    const agent = createMockAgent(['a', 'b', 'c']);
    const judge = createMockJudge('3:9\n1:7\n2:4');

    const result = await withBestOfN(agent, 'test', {
      n: 3,
      judgeModel: judge,
      criteria: 'Rank these',
      strategy: 'list-wise',
    });

    expect(result.best.text).toBe('c');
    expect(result.candidates.find((c) => c.text === 'a')!.score).toBe(7);
    expect(result.candidates.find((c) => c.text === 'b')!.score).toBe(4);
    expect(result.candidates.find((c) => c.text === 'c')!.score).toBe(9);
  });

  it('should handle judge errors gracefully', async () => {
    const agent = createMockAgent(['a', 'b']);
    const judge = createFailingJudge();

    const result = await withBestOfN(agent, 'test', {
      n: 2,
      judgeModel: judge,
      criteria: 'Rank',
      strategy: 'list-wise',
    });

    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0].score).toBe(5);
    expect(result.candidates[1].score).toBe(5);
  });
});

describe('pair-wise strategy', () => {
  it('should compare pairs and accumulate wins', async () => {
    const agent = createMockAgent(['weak', 'medium', 'strong']);

    const judge = createMockJudge('B', 'B', 'B');

    const result = await withBestOfN(agent, 'test', {
      n: 3,
      judgeModel: judge,
      criteria: 'Which is better?',
      strategy: 'pair-wise',
    });

    expect(result.best.text).toBe('strong');
    expect(result.best.score).toBe(2);
  });

  it('should handle pair-wise judge errors with ties', async () => {
    const agent = createMockAgent(['a', 'b']);
    const judge = createFailingJudge();

    const result = await withBestOfN(agent, 'test', {
      n: 2,
      judgeModel: judge,
      criteria: 'Compare',
      strategy: 'pair-wise',
    });

    expect(result.candidates[0].score).toBe(0.5);
    expect(result.candidates[1].score).toBe(0.5);
  });
});

describe('execution modes', () => {
  it('should run in parallel by default', async () => {
    const startTimes: number[] = [];
    const agent = {
      name: 'test',
      init: vi.fn().mockResolvedValue(undefined),
      stream: vi.fn().mockImplementation(async () => {
        startTimes.push(Date.now());
        await new Promise((r) => setTimeout(r, 50));
        return {
          fullStream: (async function* () {})(),
          text: Promise.resolve('ok'),
          usage: Promise.resolve({ inputTokens: 10, outputTokens: 5, totalTokens: 15 }),
        };
      }),
      getSystemPrompt: () => '',
      getToolNames: () => [],
    } as unknown as Agent;
    const judge = createMockJudge('1:8\n2:5\n3:3');

    await withBestOfN(agent, 'test', {
      n: 3,
      judgeModel: judge,
      criteria: 'Quality',
      execution: 'parallel',
    });

    expect(startTimes).toHaveLength(3);
    const spread = Math.max(...startTimes) - Math.min(...startTimes);
    expect(spread).toBeLessThan(30);
  });

  it('should run sequentially when specified', async () => {
    const callOrder: number[] = [];
    let idx = 0;
    const agent = {
      name: 'test',
      init: vi.fn().mockResolvedValue(undefined),
      stream: vi.fn().mockImplementation(async () => {
        const myIdx = idx++;
        callOrder.push(myIdx);
        await new Promise((r) => setTimeout(r, 20));
        return {
          fullStream: (async function* () {})(),
          text: Promise.resolve(`output-${myIdx}`),
          usage: Promise.resolve({ inputTokens: 10, outputTokens: 5, totalTokens: 15 }),
        };
      }),
      getSystemPrompt: () => '',
      getToolNames: () => [],
    } as unknown as Agent;
    const judge = createMockJudge('1:5\n2:5\n3:5');

    await withBestOfN(agent, 'test', {
      n: 3,
      judgeModel: judge,
      criteria: 'Quality',
      execution: 'sequential',
    });

    expect(callOrder).toEqual([0, 1, 2]);
  });
});

describe('budget cap', () => {
  it('should stop early when budget exceeded (sequential)', async () => {
    const agent = createMockAgent(['a', 'b', 'c', 'd', 'e']);
    const judge = createMockJudge('1:8\n2:5');

    const result = await withBestOfN(agent, 'test', {
      n: 5,
      judgeModel: judge,
      criteria: 'Quality',
      execution: 'sequential',
      budget: { maxTotalTokens: 300 }, // Each run uses 150, so 2 runs = 300
    });

    expect(result.runsCompleted).toBe(2);
    expect(result.budgetExceeded).toBe(true);
    expect(agent.stream).toHaveBeenCalledTimes(2);
  });

  it('should not stop if budget not exceeded', async () => {
    const agent = createMockAgent(['a', 'b', 'c']);
    const judge = createMockJudge('1:5\n2:5\n3:5');

    const result = await withBestOfN(agent, 'test', {
      n: 3,
      judgeModel: judge,
      criteria: 'Quality',
      execution: 'sequential',
      budget: { maxTotalTokens: 10000 },
    });

    expect(result.runsCompleted).toBe(3);
    expect(result.budgetExceeded).toBe(false);
  });
});

describe('error handling', () => {
  it('should handle failed agent runs gracefully', async () => {
    let callCount = 0;
    const agent = {
      name: 'test',
      init: vi.fn().mockResolvedValue(undefined),
      stream: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 2) throw new Error('Agent crashed');
        return {
          fullStream: (async function* () {})(),
          text: Promise.resolve(`output-${callCount}`),
          usage: Promise.resolve({ inputTokens: 10, outputTokens: 5, totalTokens: 15 }),
        };
      }),
      getSystemPrompt: () => '',
      getToolNames: () => [],
    } as unknown as Agent;
    const judge = createMockJudge('1:8\n2:5');

    const result = await withBestOfN(agent, 'test', {
      n: 3,
      judgeModel: judge,
      criteria: 'Quality',
    });

    expect(result.candidates).toHaveLength(2);
    expect(result.runsCompleted).toBe(2);
  });

  it('should throw if all runs fail', async () => {
    const agent = {
      name: 'test',
      init: vi.fn().mockResolvedValue(undefined),
      stream: vi.fn().mockRejectedValue(new Error('All fail')),
      getSystemPrompt: () => '',
      getToolNames: () => [],
    } as unknown as Agent;
    const judge = createMockJudge('unused');

    await expect(
      withBestOfN(agent, 'test', {
        n: 3,
        judgeModel: judge,
        criteria: 'Quality',
      }),
    ).rejects.toThrow('no candidates generated');
  });
});
