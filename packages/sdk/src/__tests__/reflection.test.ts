import { describe, it, expect, vi } from 'vitest';
import type { StepResult, ToolSet } from 'ai';

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
  buildReflectionPrompt,
  createReflectionPrepareStep,
  estimateReflectionTokens,
  type ReflectionConfig,
} from '../reflection';

describe('buildReflectionPrompt', () => {
  describe('strategy: none', () => {
    it('should return undefined for all steps', () => {
      const config: ReflectionConfig = { strategy: 'none' };
      expect(buildReflectionPrompt(config, 0)).toBeUndefined();
      expect(buildReflectionPrompt(config, 1)).toBeUndefined();
      expect(buildReflectionPrompt(config, 5)).toBeUndefined();
    });
  });

  describe('strategy: reflact', () => {
    it('should return undefined at step 0', () => {
      const config: ReflectionConfig = { strategy: 'reflact' };
      expect(buildReflectionPrompt(config, 0)).toBeUndefined();
    });

    it('should return reflection at step 1+', () => {
      const config: ReflectionConfig = { strategy: 'reflact' };
      const prompt = buildReflectionPrompt(config, 1);
      expect(prompt).toBeDefined();
      expect(prompt).toContain('<reflection>');
      expect(prompt).toContain('original goal');
    });

    it('should inject at every step after step 0', () => {
      const config: ReflectionConfig = { strategy: 'reflact' };
      expect(buildReflectionPrompt(config, 1)).toBeDefined();
      expect(buildReflectionPrompt(config, 2)).toBeDefined();
      expect(buildReflectionPrompt(config, 10)).toBeDefined();
    });

    it('should use custom template when provided', () => {
      const config: ReflectionConfig = {
        strategy: 'reflact',
        promptTemplate: 'Custom: Are you on track?',
      };
      expect(buildReflectionPrompt(config, 1)).toBe('Custom: Are you on track?');
    });
  });

  describe('strategy: periodic', () => {
    it('should return undefined at step 0', () => {
      const config: ReflectionConfig = { strategy: 'periodic', frequency: 3 };
      expect(buildReflectionPrompt(config, 0)).toBeUndefined();
    });

    it('should return undefined for non-multiple steps', () => {
      const config: ReflectionConfig = { strategy: 'periodic', frequency: 3 };
      expect(buildReflectionPrompt(config, 1)).toBeUndefined();
      expect(buildReflectionPrompt(config, 2)).toBeUndefined();
      expect(buildReflectionPrompt(config, 4)).toBeUndefined();
      expect(buildReflectionPrompt(config, 5)).toBeUndefined();
    });

    it('should return reflection at step multiples of frequency', () => {
      const config: ReflectionConfig = { strategy: 'periodic', frequency: 3 };
      expect(buildReflectionPrompt(config, 3)).toBeDefined();
      expect(buildReflectionPrompt(config, 6)).toBeDefined();
      expect(buildReflectionPrompt(config, 9)).toBeDefined();
    });

    it('should default to frequency 3', () => {
      const config: ReflectionConfig = { strategy: 'periodic' };
      expect(buildReflectionPrompt(config, 2)).toBeUndefined();
      expect(buildReflectionPrompt(config, 3)).toBeDefined();
    });

    it('should use custom template when provided', () => {
      const config: ReflectionConfig = {
        strategy: 'periodic',
        frequency: 2,
        promptTemplate: 'Reflect now!',
      };
      expect(buildReflectionPrompt(config, 2)).toBe('Reflect now!');
      expect(buildReflectionPrompt(config, 4)).toBe('Reflect now!');
    });
  });
});

describe('createReflectionPrepareStep', () => {
  const baseSystem = 'You are a helpful assistant.';

  it('should return no-op for strategy: none', () => {
    const fn = createReflectionPrepareStep(baseSystem, { strategy: 'none' });
    expect(fn({ steps: [], stepNumber: 1 })).toBeUndefined();
  });

  it('should not inject at step 0 for reflact', () => {
    const fn = createReflectionPrepareStep(baseSystem, { strategy: 'reflact' });
    expect(fn({ steps: [], stepNumber: 0 })).toBeUndefined();
  });

  it('should inject augmented system at step 1 for reflact', () => {
    const fn = createReflectionPrepareStep(baseSystem, { strategy: 'reflact' });
    const result = fn({ steps: [] as StepResult<ToolSet>[], stepNumber: 1 });
    expect(result).toBeDefined();
    expect(result!.system).toContain(baseSystem);
    expect(result!.system).toContain('<reflection>');
  });

  it('should inject at periodic frequency', () => {
    const fn = createReflectionPrepareStep(baseSystem, { strategy: 'periodic', frequency: 2 });
    expect(fn({ steps: [] as StepResult<ToolSet>[], stepNumber: 1 })).toBeUndefined();
    const result = fn({ steps: [] as StepResult<ToolSet>[], stepNumber: 2 });
    expect(result).toBeDefined();
    expect(result!.system).toContain(baseSystem);
  });

  it('should preserve the full original system prompt', () => {
    const longSystem = 'A'.repeat(1000);
    const fn = createReflectionPrepareStep(longSystem, { strategy: 'reflact' });
    const result = fn({ steps: [] as StepResult<ToolSet>[], stepNumber: 1 });
    expect(result!.system!.startsWith(longSystem)).toBe(true);
  });
});

describe('estimateReflectionTokens', () => {
  it('should return 0 for strategy: none', () => {
    expect(estimateReflectionTokens({ strategy: 'none' })).toBe(0);
  });

  it('should return positive number for reflact', () => {
    const tokens = estimateReflectionTokens({ strategy: 'reflact' });
    expect(tokens).toBeGreaterThan(0);

    expect(tokens).toBeGreaterThan(20);
    expect(tokens).toBeLessThan(150);
  });

  it('should return positive number for periodic', () => {
    const tokens = estimateReflectionTokens({ strategy: 'periodic' });
    expect(tokens).toBeGreaterThan(0);
  });

  it('should use custom template for estimation', () => {
    const tokens = estimateReflectionTokens({
      strategy: 'reflact',
      promptTemplate: 'Short',
    });
    expect(tokens).toBe(2);
  });
});

describe('agent reflection integration', () => {
  it('should accept reflection config in createAgent', async () => {
    const { createAgent } = await import('../agent');

    const agent = createAgent({
      name: 'reflection-test',
      reflection: { strategy: 'reflact' },
    });

    expect(agent).toBeDefined();
    expect(agent.name).toBe('reflection-test');
  });

  it('should accept none strategy without error', async () => {
    const { createAgent } = await import('../agent');

    const agent = createAgent({
      name: 'reflection-none-test',
      reflection: { strategy: 'none' },
    });

    expect(agent).toBeDefined();
  });

  it('should accept periodic strategy with frequency', async () => {
    const { createAgent } = await import('../agent');

    const agent = createAgent({
      name: 'reflection-periodic-test',
      reflection: { strategy: 'periodic', frequency: 5 },
    });

    expect(agent).toBeDefined();
  });
});
