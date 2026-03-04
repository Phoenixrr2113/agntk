import { describe, it, expect } from 'vitest';
import { UsageLimitExceeded, usageLimitStop, type UsageSnapshot } from '../usage-limits';
import type { StepResult, ToolSet } from 'ai';

function createMockStep(usage: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}): StepResult<ToolSet> {
  return {
    usage: {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      totalTokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
      inputTokenDetails: {
        noCacheTokens: undefined,
        cacheReadTokens: undefined,
        cacheWriteTokens: undefined,
      },
      outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
    },
  } as unknown as StepResult<ToolSet>;
}

describe('UsageLimitExceeded', () => {
  it('should contain limit type, value, current value, and usage', () => {
    const usage: UsageSnapshot = {
      requests: 5,
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
    };

    const error = new UsageLimitExceeded('maxRequests', 3, 5, usage);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(UsageLimitExceeded);
    expect(error.name).toBe('UsageLimitExceeded');
    expect(error.limitType).toBe('maxRequests');
    expect(error.limitValue).toBe(3);
    expect(error.currentValue).toBe(5);
    expect(error.usage).toEqual(usage);
    expect(error.message).toContain('maxRequests');
    expect(error.message).toContain('5');
    expect(error.message).toContain('3');
  });
});

describe('usageLimitStop', () => {
  describe('maxRequests', () => {
    it('should not stop when under limit', () => {
      const stop = usageLimitStop({ maxRequests: 5 });
      const steps = [createMockStep({}), createMockStep({})];
      expect(stop({ steps })).toBe(false);
    });

    it('should throw when exceeding maxRequests', () => {
      const stop = usageLimitStop({ maxRequests: 2 });
      const steps = [createMockStep({}), createMockStep({}), createMockStep({})];

      expect(() => stop({ steps })).toThrow(UsageLimitExceeded);

      try {
        stop({ steps });
      } catch (error) {
        const e = error as UsageLimitExceeded;
        expect(e.limitType).toBe('maxRequests');
        expect(e.limitValue).toBe(2);
        expect(e.currentValue).toBe(3);
      }
    });

    it('should throw at exactly maxRequests + 1', () => {
      const stop = usageLimitStop({ maxRequests: 3 });

      expect(stop({ steps: [createMockStep({}), createMockStep({}), createMockStep({})] })).toBe(
        false,
      );

      expect(() =>
        stop({
          steps: [createMockStep({}), createMockStep({}), createMockStep({}), createMockStep({})],
        }),
      ).toThrow(UsageLimitExceeded);
    });
  });

  describe('maxInputTokens', () => {
    it('should not stop when under limit', () => {
      const stop = usageLimitStop({ maxInputTokens: 1000 });
      const steps = [createMockStep({ inputTokens: 300 }), createMockStep({ inputTokens: 400 })];
      expect(stop({ steps })).toBe(false);
    });

    it('should throw when exceeding maxInputTokens', () => {
      const stop = usageLimitStop({ maxInputTokens: 500 });
      const steps = [createMockStep({ inputTokens: 300 }), createMockStep({ inputTokens: 300 })];

      try {
        stop({ steps });
        expect.unreachable('Should have thrown');
      } catch (error) {
        const e = error as UsageLimitExceeded;
        expect(e.limitType).toBe('maxInputTokens');
        expect(e.limitValue).toBe(500);
        expect(e.currentValue).toBe(600);
      }
    });
  });

  describe('maxOutputTokens', () => {
    it('should throw when exceeding maxOutputTokens', () => {
      const stop = usageLimitStop({ maxOutputTokens: 200 });
      const steps = [createMockStep({ outputTokens: 100 }), createMockStep({ outputTokens: 150 })];

      try {
        stop({ steps });
        expect.unreachable('Should have thrown');
      } catch (error) {
        const e = error as UsageLimitExceeded;
        expect(e.limitType).toBe('maxOutputTokens');
        expect(e.currentValue).toBe(250);
      }
    });
  });

  describe('maxTotalTokens', () => {
    it('should not stop when under limit', () => {
      const stop = usageLimitStop({ maxTotalTokens: 10000 });
      const steps = [
        createMockStep({ inputTokens: 500, outputTokens: 200, totalTokens: 700 }),
        createMockStep({ inputTokens: 600, outputTokens: 300, totalTokens: 900 }),
      ];
      expect(stop({ steps })).toBe(false);
    });

    it('should throw when exceeding maxTotalTokens', () => {
      const stop = usageLimitStop({ maxTotalTokens: 1000 });
      const steps = [
        createMockStep({ inputTokens: 500, outputTokens: 200, totalTokens: 700 }),
        createMockStep({ inputTokens: 300, outputTokens: 200, totalTokens: 500 }),
      ];

      try {
        stop({ steps });
        expect.unreachable('Should have thrown');
      } catch (error) {
        const e = error as UsageLimitExceeded;
        expect(e.limitType).toBe('maxTotalTokens');
        expect(e.limitValue).toBe(1000);
        expect(e.currentValue).toBe(1200);
        expect(e.usage.requests).toBe(2);
      }
    });
  });

  describe('multiple limits', () => {
    it('should check all limits and throw on first exceeded', () => {
      const stop = usageLimitStop({
        maxRequests: 10,
        maxInputTokens: 1000,
        maxTotalTokens: 5000,
      });

      const steps = [createMockStep({ inputTokens: 200, outputTokens: 100, totalTokens: 300 })];
      expect(stop({ steps })).toBe(false);
    });

    it('should throw maxRequests before checking tokens', () => {
      const stop = usageLimitStop({
        maxRequests: 1,
        maxTotalTokens: 100000, // Would not be exceeded
      });

      const steps = [createMockStep({}), createMockStep({})];

      try {
        stop({ steps });
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect((error as UsageLimitExceeded).limitType).toBe('maxRequests');
      }
    });
  });

  describe('no limits', () => {
    it('should never stop when no limits are set', () => {
      const stop = usageLimitStop({});
      const manySteps = Array.from({ length: 100 }, () =>
        createMockStep({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 }),
      );
      expect(stop({ steps: manySteps })).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle steps with undefined usage values', () => {
      const stop = usageLimitStop({ maxTotalTokens: 1000 });
      const step = {
        usage: {
          inputTokens: undefined,
          outputTokens: undefined,
          totalTokens: undefined,
          inputTokenDetails: {
            noCacheTokens: undefined,
            cacheReadTokens: undefined,
            cacheWriteTokens: undefined,
          },
          outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
        },
      } as unknown as StepResult<ToolSet>;
      expect(stop({ steps: [step] })).toBe(false);
    });

    it('should handle empty steps array', () => {
      const stop = usageLimitStop({ maxRequests: 5 });
      expect(stop({ steps: [] })).toBe(false);
    });
  });
});
