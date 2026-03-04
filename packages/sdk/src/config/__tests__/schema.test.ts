import { describe, it, expect } from 'vitest';
import {
  AgentConfigSchema,
  PartialAgentConfigSchema,
  RoleConfigSchema,
  ModelTierSchema,
} from '../schema';

describe('Config Schema', () => {
  describe('ModelTierSchema', () => {
    it('should accept valid tiers', () => {
      expect(ModelTierSchema.parse('fast')).toBe('fast');
      expect(ModelTierSchema.parse('standard')).toBe('standard');
      expect(ModelTierSchema.parse('reasoning')).toBe('reasoning');
      expect(ModelTierSchema.parse('powerful')).toBe('powerful');
    });

    it('should reject invalid tiers', () => {
      expect(() => ModelTierSchema.parse('invalid')).toThrow();
    });
  });

  describe('RoleConfigSchema', () => {
    it('should accept valid role config', () => {
      const result = RoleConfigSchema.parse({
        systemPrompt: 'You are a helpful assistant',
        recommendedModel: 'powerful',
        defaultTools: ['shell', 'grep'],
      });
      expect(result.systemPrompt).toBe('You are a helpful assistant');
      expect(result.recommendedModel).toBe('powerful');
    });

    it('should allow partial role config', () => {
      const result = RoleConfigSchema.parse({
        defaultTools: ['shell'],
      });
      expect(result.defaultTools).toEqual(['shell']);
      expect(result.systemPrompt).toBeUndefined();
    });
  });

  describe('AgentConfigSchema', () => {
    it('should accept full valid config', () => {
      const config = {
        models: {
          defaultProvider: 'openrouter',
          tiers: {
            fast: 'some-fast-model',
            powerful: 'some-powerful-model',
          },
        },
        roles: {
          debugger: {
            systemPrompt: 'You debug code',
            recommendedModel: 'reasoning',
          },
        },
        toolPresets: {
          readonly: {
            include: ['glob', 'grep'],
            exclude: ['shell'],
          },
        },
        templates: {
          variables: {
            projectName: 'MyProject',
            language: 'TypeScript',
          },
        },
        memory: {
          path: './memory',
          topK: 10,
        },
        maxSteps: 20,
        workspaceRoot: '/app',
      };

      const result = AgentConfigSchema.parse(config);
      expect(result.models?.defaultProvider).toBe('openrouter');
      expect(result.roles?.debugger?.systemPrompt).toBe('You debug code');
      expect(result.maxSteps).toBe(20);
    });

    it('should accept empty config', () => {
      const result = AgentConfigSchema.parse({});
      expect(result).toBeDefined();
    });

    it('should reject invalid provider', () => {
      expect(() =>
        AgentConfigSchema.parse({
          models: {
            defaultProvider: 'invalid-provider',
          },
        }),
      ).toThrow();
    });
  });

  describe('PartialAgentConfigSchema', () => {
    it('should accept any partial config', () => {
      const result = PartialAgentConfigSchema.parse({
        maxSteps: 5,
      });
      expect(result.maxSteps).toBe(5);
    });
  });
});
