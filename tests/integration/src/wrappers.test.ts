import { describe, it, expect } from 'vitest';
import { createAgent, UsageLimitExceeded, usageLimitStop } from '@agntk/core';
import {
  withBestOfN,
  buildReflectionPrompt,
  estimateReflectionTokens,
  resolveApprovalConfig,
  isDangerousTool,
  DANGEROUS_TOOLS,
} from '@agntk/core/advanced';
import type { ReflectionConfig } from '@agntk/core/advanced';
import { createMockModel, createMockMultiModel } from './setup';

describe('Wrappers', () => {
  describe('Best-of-N', () => {
    it('should generate N candidates and select the best via judge', async () => {
      const agent = createAgent({
        name: 'best-of-n-test',
        model: createMockMultiModel([
          'Candidate 1: A basic greeting',
          'Candidate 2: An eloquent welcome',
        ]),
        instructions: 'You are a greeting writer.',
        maxSteps: 1,
      });

      const judgeModel = createMockModel(
        '{"ranking": [2, 1], "reasoning": "Candidate 2 is more eloquent"}',
      );

      const result = await withBestOfN(agent, 'Write a greeting', {
        n: 2,
        judgeModel,
        criteria: 'Eloquence and warmth',
      });

      expect(result.candidates).toHaveLength(2);
      expect(result.best).toBeDefined();
      expect(result.best.text).toBeDefined();
    });
  });

  describe('Reflection', () => {
    it('should build a reflection prompt for reflact strategy at step > 0', () => {
      const config: ReflectionConfig = { strategy: 'reflact' };
      const prompt = buildReflectionPrompt(config, 1);

      expect(prompt).toBeDefined();
      expect(typeof prompt).toBe('string');
      expect(prompt!.length).toBeGreaterThan(0);
    });

    it('should return undefined for step 0 (no reflection on initial call)', () => {
      const config: ReflectionConfig = { strategy: 'reflact' };
      const prompt = buildReflectionPrompt(config, 0);
      expect(prompt).toBeUndefined();
    });

    it('should return undefined for none strategy', () => {
      const config: ReflectionConfig = { strategy: 'none' };
      const prompt = buildReflectionPrompt(config, 1);
      expect(prompt).toBeUndefined();
    });

    it('should estimate reflection token overhead', () => {
      const config: ReflectionConfig = { strategy: 'reflact' };
      const estimate = estimateReflectionTokens(config);

      expect(estimate).toBeGreaterThan(0);
      expect(typeof estimate).toBe('number');
    });
  });

  describe('Usage Limits', () => {
    it('should export UsageLimitExceeded error class', () => {
      const error = new UsageLimitExceeded('maxRequests', 5, 10);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('maxRequests');
    });

    it('should create a stop condition with usageLimitStop', () => {
      const stop = usageLimitStop({ maxRequests: 3 });
      expect(typeof stop).toBe('function');
    });
  });

  describe('Approval', () => {
    it('should identify dangerous tools', () => {
      expect(isDangerousTool('shell')).toBe(true);
      expect(isDangerousTool('glob')).toBe(false);
    });

    it('should export DANGEROUS_TOOLS as a Set', () => {
      expect(DANGEROUS_TOOLS).toBeInstanceOf(Set);
      expect(DANGEROUS_TOOLS.has('shell')).toBe(true);
    });

    it('should resolve approval config from boolean', () => {
      const config = resolveApprovalConfig(true);
      expect(config).toBeDefined();
      expect(config!.enabled).toBe(true);
    });

    it('should return undefined for false/undefined', () => {
      expect(resolveApprovalConfig(false)).toBeUndefined();
      expect(resolveApprovalConfig(undefined)).toBeUndefined();
    });

    it('should pass through custom config', () => {
      const custom = { enabled: true, tools: ['shell'], timeout: 30000 };
      const config = resolveApprovalConfig(custom);
      expect(config).toEqual(custom);
    });
  });
});
