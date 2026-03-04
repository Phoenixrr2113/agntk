import { describe, it, expect, vi, beforeEach } from 'vitest';

const { generateObjectMock } = vi.hoisted(() => {
  const generateObjectMock = vi.fn().mockResolvedValue({
    object: {
      score: 0.9,
      critique: 'Good output',
      strengths: ['Clear', 'Accurate'],
      weaknesses: [],
    },
    usage: { promptTokens: 50, completionTokens: 20 },
  });
  return { generateObjectMock };
});

vi.mock('@agntk/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../models', () => ({
  resolveModel: () => ({
    modelId: 'mock-judge',
    model: {
      provider: 'mock',
      specificationVersion: 'v1',
    },
  }),
}));

vi.mock('ai', () => ({
  generateObject: generateObjectMock,
}));

import { withRefineLoop, type EvaluationResult } from '../wrappers/refine-loop';
import type { Agent } from '../types/agent';

function createMockAgent(responses: string[]): Agent {
  let callIndex = 0;

  return {
    name: 'test-agent',
    init: vi.fn().mockResolvedValue(undefined),
    getSystemPrompt: () => 'test prompt',
    getToolNames: () => [],
    getModelId: () => 'mock-model',
    stream: vi.fn().mockImplementation(async () => {
      const text = responses[callIndex] ?? responses[responses.length - 1];
      callIndex++;
      return {
        fullStream: (async function* () {
          yield { type: 'text-delta', text };
        })(),
        text: Promise.resolve(text),
        usage: Promise.resolve({ inputTokens: 100, outputTokens: 50 }),
      };
    }),
  };
}

describe('withRefineLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('basic behavior', () => {
    it('should pass on first iteration when score meets threshold', async () => {
      const agent = createMockAgent(['Great answer']);

      const result = await withRefineLoop(agent, 'Write a haiku', {
        criteria: 'Must follow haiku format',
        threshold: 0.7,
      });

      expect(result.text).toBe('Great answer');
      expect(result.score).toBe(0.9);
      expect(result.iterations).toBe(1);
      expect(result.thresholdMet).toBe(true);
      expect(result.history).toHaveLength(1);
    });

    it('should return result with usage info', async () => {
      const agent = createMockAgent(['Answer']);

      const result = await withRefineLoop(agent, 'Test', {
        criteria: 'Must be good',
      });

      expect(result.usage).toBeDefined();
      expect(result.usage.inputTokens).toBeGreaterThan(0);
      expect(result.usage.totalTokens).toBeGreaterThan(0);
    });
  });

  describe('iterative refinement', () => {
    it('should retry with critique when score below threshold', async () => {
      const agent = createMockAgent(['Bad answer', 'Better answer', 'Great answer']);

      generateObjectMock
        .mockResolvedValueOnce({
          object: {
            score: 0.3,
            critique: 'Needs more detail',
            strengths: ['Concise'],
            weaknesses: ['Too vague', 'Missing examples'],
          },
          usage: { promptTokens: 50, completionTokens: 20 },
        })
        .mockResolvedValueOnce({
          object: {
            score: 0.85,
            critique: 'Much better',
            strengths: ['Detailed', 'Well-structured'],
            weaknesses: [],
          },
          usage: { promptTokens: 50, completionTokens: 20 },
        });

      const result = await withRefineLoop(agent, 'Explain recursion', {
        criteria: 'Clear explanation with examples',
        threshold: 0.7,
        maxIterations: 3,
      });

      expect(result.iterations).toBe(2);
      expect(result.thresholdMet).toBe(true);
      expect(result.history).toHaveLength(2);
      expect(result.history[0].score).toBe(0.3);
      expect(result.history[1].score).toBe(0.85);
    });

    it('should include critique in subsequent prompts', async () => {
      const agent = createMockAgent(['First try', 'Second try']);

      generateObjectMock
        .mockResolvedValueOnce({
          object: {
            score: 0.4,
            critique: 'Missing error handling',
            strengths: ['Good structure'],
            weaknesses: ['No edge cases'],
          },
          usage: { promptTokens: 50, completionTokens: 20 },
        })
        .mockResolvedValueOnce({
          object: {
            score: 0.9,
            critique: 'Good',
            strengths: ['Complete'],
            weaknesses: [],
          },
          usage: { promptTokens: 50, completionTokens: 20 },
        });

      await withRefineLoop(agent, 'Write a function', {
        criteria: 'Must handle errors',
        threshold: 0.7,
      });

      const secondCall = (agent.stream as ReturnType<typeof vi.fn>).mock.calls[1];
      expect(secondCall[0].prompt).toContain('0.40/1.0');
      expect(secondCall[0].prompt).toContain('Missing error handling');
      expect(secondCall[0].prompt).toContain('No edge cases');
      expect(secondCall[0].prompt).toContain('Write a function');
    });
  });

  describe('max iterations', () => {
    it('should return best attempt when max iterations reached', async () => {
      const agent = createMockAgent(['V1', 'V2', 'V3']);

      generateObjectMock
        .mockResolvedValueOnce({
          object: { score: 0.3, critique: 'Bad', strengths: [], weaknesses: ['Poor'] },
          usage: { promptTokens: 50, completionTokens: 20 },
        })
        .mockResolvedValueOnce({
          object: {
            score: 0.5,
            critique: 'Better',
            strengths: ['Improved'],
            weaknesses: ['Still lacking'],
          },
          usage: { promptTokens: 50, completionTokens: 20 },
        })
        .mockResolvedValueOnce({
          object: { score: 0.4, critique: 'Regressed', strengths: [], weaknesses: ['Worse'] },
          usage: { promptTokens: 50, completionTokens: 20 },
        });

      const result = await withRefineLoop(agent, 'Complex task', {
        criteria: 'Must be perfect',
        threshold: 0.9,
        maxIterations: 3,
      });

      expect(result.thresholdMet).toBe(false);
      expect(result.iterations).toBe(3);

      expect(result.score).toBe(0.5);
      expect(result.text).toBe('V2');
      expect(result.history).toHaveLength(3);
    });

    it('should default to 3 max iterations', async () => {
      const agent = createMockAgent(['A', 'B', 'C', 'D']);

      generateObjectMock.mockResolvedValue({
        object: { score: 0.1, critique: 'Bad', strengths: [], weaknesses: ['Everything'] },
        usage: { promptTokens: 50, completionTokens: 20 },
      });

      const result = await withRefineLoop(agent, 'Test', {
        criteria: 'Impossible',
        threshold: 1.0,
      });

      expect(result.iterations).toBe(3);

      expect(agent.stream).toHaveBeenCalledTimes(3);
    });
  });

  describe('custom evaluator', () => {
    it('should use custom evaluator instead of LLM judge', async () => {
      const agent = createMockAgent(['Output']);
      const customEvaluator = vi.fn().mockResolvedValue({
        score: 0.95,
        critique: 'Almost perfect',
        strengths: ['Excellent'],
        weaknesses: [],
      } satisfies EvaluationResult);

      const result = await withRefineLoop(agent, 'Test', {
        criteria: 'Test criteria',
        evaluator: customEvaluator,
      });

      expect(result.score).toBe(0.95);
      expect(customEvaluator).toHaveBeenCalledWith('Output');

      expect(generateObjectMock).not.toHaveBeenCalled();
    });

    it('should pass output to custom evaluator on each iteration', async () => {
      const agent = createMockAgent(['First', 'Second']);
      let callCount = 0;

      const customEvaluator = vi.fn().mockImplementation(async () => {
        callCount++;
        return {
          score: callCount >= 2 ? 0.8 : 0.3,
          critique: callCount >= 2 ? 'Good' : 'Needs work',
        };
      });

      const result = await withRefineLoop(agent, 'Improve', {
        criteria: 'Must be good',
        evaluator: customEvaluator,
        threshold: 0.7,
      });

      expect(result.iterations).toBe(2);
      expect(customEvaluator).toHaveBeenCalledTimes(2);
    });
  });

  describe('threshold', () => {
    it('should default threshold to 0.7', async () => {
      const agent = createMockAgent(['Answer']);

      generateObjectMock.mockResolvedValueOnce({
        object: { score: 0.75, critique: 'Good enough', strengths: [], weaknesses: [] },
        usage: { promptTokens: 50, completionTokens: 20 },
      });

      const result = await withRefineLoop(agent, 'Test', {
        criteria: 'Test',
      });

      expect(result.thresholdMet).toBe(true);
      expect(result.iterations).toBe(1);
    });

    it('should respect custom threshold', async () => {
      const agent = createMockAgent(['Answer']);

      generateObjectMock.mockResolvedValue({
        object: {
          score: 0.75,
          critique: 'Not good enough',
          strengths: [],
          weaknesses: ['Below threshold'],
        },
        usage: { promptTokens: 50, completionTokens: 20 },
      });

      const result = await withRefineLoop(agent, 'Test', {
        criteria: 'Test',
        threshold: 0.9,
        maxIterations: 1,
      });

      expect(result.thresholdMet).toBe(false);
    });
  });

  describe('history', () => {
    it('should track all attempts in history', async () => {
      const agent = createMockAgent(['Attempt 1', 'Attempt 2']);

      generateObjectMock
        .mockResolvedValueOnce({
          object: {
            score: 0.4,
            critique: 'Critique 1',
            strengths: ['S1'],
            weaknesses: ['W1'],
          },
          usage: { promptTokens: 50, completionTokens: 20 },
        })
        .mockResolvedValueOnce({
          object: {
            score: 0.8,
            critique: 'Critique 2',
            strengths: ['S2', 'S3'],
            weaknesses: [],
          },
          usage: { promptTokens: 50, completionTokens: 20 },
        });

      const result = await withRefineLoop(agent, 'Test', {
        criteria: 'Test',
        threshold: 0.7,
      });

      expect(result.history).toHaveLength(2);

      expect(result.history[0].text).toBe('Attempt 1');
      expect(result.history[0].score).toBe(0.4);
      expect(result.history[0].critique).toBe('Critique 1');
      expect(result.history[0].strengths).toEqual(['S1']);
      expect(result.history[0].weaknesses).toEqual(['W1']);

      expect(result.history[1].text).toBe('Attempt 2');
      expect(result.history[1].score).toBe(0.8);
    });
  });

  describe('usage tracking', () => {
    it('should accumulate usage across iterations', async () => {
      const agent = createMockAgent(['A', 'B']);

      generateObjectMock
        .mockResolvedValueOnce({
          object: { score: 0.3, critique: 'Bad', strengths: [], weaknesses: [] },
          usage: { promptTokens: 100, completionTokens: 50 },
        })
        .mockResolvedValueOnce({
          object: { score: 0.8, critique: 'Good', strengths: [], weaknesses: [] },
          usage: { promptTokens: 100, completionTokens: 50 },
        });

      const result = await withRefineLoop(agent, 'Test', {
        criteria: 'Test',
        threshold: 0.7,
      });

      expect(result.usage.totalTokens).toBeGreaterThan(0);
      expect(result.usage.inputTokens).toBeGreaterThan(0);
      expect(result.usage.outputTokens).toBeGreaterThan(0);
    });
  });
});
