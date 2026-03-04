import { describe, it, expect, vi } from 'vitest';
import type { StepResult, ToolSet } from 'ai';
import type { EvalAgentResult, EvalReporter } from '../evals/types';
import type { Agent } from '../types/agent';

vi.mock('@agntk/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    time: vi.fn(() => vi.fn()),
    child: vi.fn(() => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      time: vi.fn(() => vi.fn()),
      trace: vi.fn(),
    })),
  }),
}));

import {
  toolCalled,
  noToolCalled,
  toolCalledTimes,
  outputMatches,
  outputContains,
  stepCount,
  tokenUsage,
  custom,
} from '../evals/assertions';
import { createEvalSuite } from '../evals/runner';

function makeResult(overrides: Partial<EvalAgentResult> = {}): EvalAgentResult {
  return {
    text: overrides.text ?? 'Hello world',
    steps: overrides.steps ?? [],
    totalUsage: overrides.totalUsage ?? { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
  };
}

function makeStep(toolCalls: Array<{ toolName: string }> = []): StepResult<ToolSet> {
  return {
    toolCalls: toolCalls.map((tc) => ({
      type: 'tool-call' as const,
      toolCallId: 'tc-1',
      toolName: tc.toolName,
      args: {},
    })),
    toolResults: [],
    text: '',
  } as unknown as StepResult<ToolSet>;
}

function createMockAgent(text = 'mock output', _steps: StepResult<ToolSet>[] = []): Agent {
  return {
    name: 'test-agent',
    init: vi.fn().mockResolvedValue(undefined),
    stream: vi.fn().mockResolvedValue({
      fullStream: (async function* () {})(),
      text: Promise.resolve(text),
      usage: Promise.resolve({ inputTokens: 100, outputTokens: 50, totalTokens: 150 }),
    }),
    getSystemPrompt: () => 'test prompt',
    getToolNames: () => [],
    getModelId: () => 'mock-model',
  } as unknown as Agent;
}

describe('toolCalled', () => {
  it('should pass when tool was called', () => {
    const assertion = toolCalled('shell');
    const result = assertion.check(
      makeResult({
        steps: [makeStep([{ toolName: 'shell' }])],
      }),
    );
    expect(result).toMatchObject({ passed: true });
  });

  it('should fail when tool was not called', () => {
    const assertion = toolCalled('shell');
    const result = assertion.check(makeResult({ steps: [] }));
    expect(result).toMatchObject({ passed: false });
    expect((result as { message?: string }).message).toContain('shell');
  });
});

describe('noToolCalled', () => {
  it('should pass when tool was not called', () => {
    const assertion = noToolCalled('dangerous_tool');
    const result = assertion.check(makeResult({ steps: [] }));
    expect(result).toMatchObject({ passed: true });
  });

  it('should fail when tool was called', () => {
    const assertion = noToolCalled('dangerous_tool');
    const result = assertion.check(
      makeResult({
        steps: [makeStep([{ toolName: 'dangerous_tool' }])],
      }),
    );
    expect(result).toMatchObject({ passed: false });
  });
});

describe('toolCalledTimes', () => {
  it('should pass when tool called the expected number of times', () => {
    const assertion = toolCalledTimes('shell', 2);
    const result = assertion.check(
      makeResult({
        steps: [
          makeStep([{ toolName: 'shell' }]),
          makeStep([{ toolName: 'shell' }, { toolName: 'read' }]),
        ],
      }),
    );
    expect(result).toMatchObject({ passed: true });
  });

  it('should fail when count does not match', () => {
    const assertion = toolCalledTimes('shell', 3);
    const result = assertion.check(
      makeResult({
        steps: [makeStep([{ toolName: 'shell' }])],
      }),
    );
    expect(result).toMatchObject({ passed: false });
    expect((result as { message?: string }).message).toContain('Expected 3');
  });
});

describe('outputMatches', () => {
  it('should pass when output matches pattern', () => {
    const assertion = outputMatches(/hello/i);
    const result = assertion.check(makeResult({ text: 'Hello world' }));
    expect(result).toMatchObject({ passed: true });
  });

  it('should fail when output does not match', () => {
    const assertion = outputMatches(/goodbye/);
    const result = assertion.check(makeResult({ text: 'Hello world' }));
    expect(result).toMatchObject({ passed: false });
  });
});

describe('outputContains', () => {
  it('should pass when output contains text', () => {
    const assertion = outputContains('world');
    const result = assertion.check(makeResult({ text: 'Hello world' }));
    expect(result).toMatchObject({ passed: true });
  });

  it('should fail when output does not contain text', () => {
    const assertion = outputContains('foo');
    const result = assertion.check(makeResult({ text: 'Hello world' }));
    expect(result).toMatchObject({ passed: false });
  });
});

describe('stepCount', () => {
  it('should pass when step count is within range', () => {
    const assertion = stepCount(1, 3);
    const result = assertion.check(
      makeResult({
        steps: [makeStep(), makeStep()],
      }),
    );
    expect(result).toMatchObject({ passed: true });
  });

  it('should fail when below min', () => {
    const assertion = stepCount(3, 5);
    const result = assertion.check(
      makeResult({
        steps: [makeStep()],
      }),
    );
    expect(result).toMatchObject({ passed: false });
  });

  it('should fail when above max', () => {
    const assertion = stepCount(1, 2);
    const result = assertion.check(
      makeResult({
        steps: [makeStep(), makeStep(), makeStep()],
      }),
    );
    expect(result).toMatchObject({ passed: false });
  });

  it('should work with min only (no max)', () => {
    const assertion = stepCount(1);
    const result = assertion.check(
      makeResult({
        steps: [makeStep(), makeStep(), makeStep(), makeStep()],
      }),
    );
    expect(result).toMatchObject({ passed: true });
  });
});

describe('tokenUsage', () => {
  it('should pass when under budget', () => {
    const assertion = tokenUsage(500);
    const result = assertion.check(
      makeResult({
        totalUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      }),
    );
    expect(result).toMatchObject({ passed: true });
  });

  it('should fail when over budget', () => {
    const assertion = tokenUsage(100);
    const result = assertion.check(
      makeResult({
        totalUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      }),
    );
    expect(result).toMatchObject({ passed: false });
    expect((result as { message?: string }).message).toContain('150');
  });
});

describe('custom', () => {
  it('should pass with boolean return', () => {
    const assertion = custom('always-pass', () => true);
    const result = assertion.check(makeResult());
    expect(result).toMatchObject({ passed: true });
  });

  it('should handle object return', () => {
    const assertion = custom('custom-check', () => ({
      passed: false,
      message: 'Custom failure',
    }));
    const result = assertion.check(makeResult());
    expect(result).toMatchObject({ passed: false, message: 'Custom failure' });
  });

  it('should receive the full result', () => {
    const checkFn = vi.fn().mockReturnValue(true);
    const assertion = custom('spy', checkFn);
    const evalResult = makeResult({ text: 'test output' });
    assertion.check(evalResult);
    expect(checkFn).toHaveBeenCalledWith(evalResult);
  });
});

describe('createEvalSuite', () => {
  it('should create a suite with name and cases', () => {
    const agent = createMockAgent();
    const suite = createEvalSuite({
      name: 'test-suite',
      agent,
      cases: [{ name: 'case-1', prompt: 'hello', assertions: [outputContains('mock')] }],
    });

    expect(suite.name).toBe('test-suite');
    expect(suite.cases).toHaveLength(1);
  });

  it('should run all cases and return results', async () => {
    const agent = createMockAgent('hello world');
    const suite = createEvalSuite({
      name: 'test-suite',
      agent,
      cases: [
        { name: 'case-1', prompt: 'greet me', assertions: [outputContains('hello')] },
        { name: 'case-2', prompt: 'greet again', assertions: [outputContains('world')] },
      ],
    });

    const results = await suite.run();

    expect(results.totalCases).toBe(2);
    expect(results.passed).toBe(2);
    expect(results.failed).toBe(0);
    expect(results.cases).toHaveLength(2);
    expect(results.duration).toBeGreaterThanOrEqual(0);
  });

  it('should mark failing assertions', async () => {
    const agent = createMockAgent('hello');
    const suite = createEvalSuite({
      name: 'test-suite',
      agent,
      cases: [{ name: 'case-1', prompt: 'greet', assertions: [outputContains('goodbye')] }],
    });

    const results = await suite.run();

    expect(results.passed).toBe(0);
    expect(results.failed).toBe(1);
    expect(results.cases[0].passed).toBe(false);
    expect(results.cases[0].assertions[0].passed).toBe(false);
  });

  it('should handle agent errors gracefully', async () => {
    const agent = createMockAgent();
    (agent.stream as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Model failed'));

    const suite = createEvalSuite({
      name: 'error-suite',
      agent,
      cases: [{ name: 'case-1', prompt: 'fail', assertions: [outputContains('anything')] }],
    });

    const results = await suite.run();

    expect(results.failed).toBe(1);
    expect(results.cases[0].passed).toBe(false);
    expect(results.cases[0].error).toContain('Model failed');
  });

  it('should respect maxConcurrency', async () => {
    let running = 0;
    let maxRunning = 0;

    const agent = createMockAgent();
    (agent.stream as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 50));
      running--;
      return {
        fullStream: (async function* () {})(),
        text: Promise.resolve('ok'),
        usage: Promise.resolve({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
      };
    });

    const suite = createEvalSuite({
      name: 'concurrency-suite',
      agent,
      maxConcurrency: 2,
      cases: [
        { name: 'c1', prompt: '1', assertions: [outputContains('ok')] },
        { name: 'c2', prompt: '2', assertions: [outputContains('ok')] },
        { name: 'c3', prompt: '3', assertions: [outputContains('ok')] },
        { name: 'c4', prompt: '4', assertions: [outputContains('ok')] },
      ],
    });

    await suite.run();

    expect(maxRunning).toBeLessThanOrEqual(2);
  });

  it('should handle timeout', async () => {
    const agent = createMockAgent();
    (agent.stream as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise((r) => setTimeout(r, 5000)),
    );

    const suite = createEvalSuite({
      name: 'timeout-suite',
      agent,
      cases: [{ name: 'slow', prompt: 'wait', assertions: [outputContains('x')], timeout: 50 }],
    });

    const results = await suite.run();

    expect(results.failed).toBe(1);
    expect(results.cases[0].error).toContain('timed out');
  });

  it('should call custom reporter callbacks', async () => {
    const agent = createMockAgent('ok');
    const reporter: EvalReporter = {
      onCaseStart: vi.fn(),
      onCaseEnd: vi.fn(),
      onSuiteEnd: vi.fn(),
    };

    const suite = createEvalSuite({
      name: 'reporter-suite',
      agent,
      reporter,
      cases: [{ name: 'case-1', prompt: 'test', assertions: [outputContains('ok')] }],
    });

    await suite.run();

    expect(reporter.onCaseStart).toHaveBeenCalledWith('case-1');
    expect(reporter.onCaseEnd).toHaveBeenCalledTimes(1);
    expect(reporter.onSuiteEnd).toHaveBeenCalledTimes(1);
    expect((reporter.onSuiteEnd as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      name: 'reporter-suite',
      totalCases: 1,
      passed: 1,
    });
  });

  it('should work with JSON reporter', async () => {
    const agent = createMockAgent('ok');
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const suite = createEvalSuite({
      name: 'json-suite',
      agent,
      reporter: 'json',
      cases: [{ name: 'case-1', prompt: 'test', assertions: [outputContains('ok')] }],
    });

    await suite.run();

    expect(writeSpy).toHaveBeenCalled();
    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.suite).toBe('json-suite');
    expect(parsed.passed).toBe(1);

    writeSpy.mockRestore();
  });

  it('should support multiple assertions per case', async () => {
    const agent = createMockAgent('Hello world');

    const suite = createEvalSuite({
      name: 'multi-assert',
      agent,
      cases: [
        {
          name: 'multiple',
          prompt: 'greet',
          assertions: [outputContains('Hello'), outputContains('world'), outputMatches(/^Hello/)],
        },
      ],
    });

    const results = await suite.run();

    expect(results.passed).toBe(1);
    expect(results.cases[0].assertions).toHaveLength(3);
    expect(results.cases[0].assertions.every((a) => a.passed)).toBe(true);
  });

  it('should fail case if any assertion fails', async () => {
    const agent = createMockAgent('Hello');

    const suite = createEvalSuite({
      name: 'partial-fail',
      agent,
      cases: [
        {
          name: 'mixed',
          prompt: 'greet',
          assertions: [
            outputContains('Hello'),
            outputContains('goodbye'), // fails
          ],
        },
      ],
    });

    const results = await suite.run();

    expect(results.failed).toBe(1);
    expect(results.cases[0].passed).toBe(false);
    expect(results.cases[0].assertions[0].passed).toBe(true);
    expect(results.cases[0].assertions[1].passed).toBe(false);
  });
});
