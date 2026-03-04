import { describe, it, expect } from 'vitest';
import {
  getConfig,
  configure,
  defineConfig,
  getModelForTier,
  DEFAULT_MODELS,
  DEFAULT_PROVIDER,
} from '@agntk/core';

describe('Configuration', () => {
  describe('defaults', () => {
    it('should export DEFAULT_PROVIDER as openrouter', () => {
      expect(DEFAULT_PROVIDER).toBe('openrouter');
    });

    it('should export DEFAULT_MODELS with all providers', () => {
      expect(DEFAULT_MODELS).toBeDefined();
      expect(DEFAULT_MODELS.openrouter).toBeDefined();
      expect(DEFAULT_MODELS.ollama).toBeDefined();
      expect(DEFAULT_MODELS.openai).toBeDefined();
    });

    it('should have all tiers for each provider', () => {
      const tiers = ['fast', 'standard', 'reasoning', 'powerful'];
      for (const provider of ['openrouter', 'ollama', 'openai'] as const) {
        for (const tier of tiers) {
          expect(
            DEFAULT_MODELS[provider][tier as keyof typeof DEFAULT_MODELS.openrouter],
          ).toBeDefined();
        }
      }
    });
  });

  describe('getConfig', () => {
    it('should return a config object with models', () => {
      const config = getConfig();
      expect(config).toBeDefined();
      expect(config.models).toBeDefined();
    });

    it('should have a default provider', () => {
      const config = getConfig();
      expect(config.models?.defaultProvider).toBeDefined();
    });
  });

  describe('configure', () => {
    it('should merge custom configuration', () => {
      configure({ maxSteps: 50 });
      const config = getConfig();
      expect(config.maxSteps).toBe(50);
    });

    it('should deep merge model configuration', () => {
      configure({
        models: {
          tiers: { fast: 'custom/fast-model' },
        },
      });
      const config = getConfig();
      expect(config.models?.tiers?.fast).toBe('custom/fast-model');
    });
  });

  describe('defineConfig', () => {
    it('should pass through config unchanged', () => {
      const config = defineConfig({ maxSteps: 20 });
      expect(config).toEqual({ maxSteps: 20 });
    });

    it('should accept complex config', () => {
      const config = defineConfig({
        models: {
          defaultProvider: 'ollama',
          tiers: { standard: 'llama3:8b' },
        },
        maxSteps: 15,
      });
      expect(config.models?.defaultProvider).toBe('ollama');
      expect(config.models?.tiers?.standard).toBe('llama3:8b');
    });
  });

  describe('getModelForTier', () => {
    it('should return default model for standard tier', () => {
      const model = getModelForTier('standard');
      expect(typeof model).toBe('string');
      expect(model.length).toBeGreaterThan(0);
    });

    it('should return different models for different tiers', () => {
      const fast = getModelForTier('fast');
      const powerful = getModelForTier('powerful');

      expect(typeof fast).toBe('string');
      expect(typeof powerful).toBe('string');
    });

    it('should respect provider parameter', () => {
      const ollamaModel = getModelForTier('standard', 'ollama');
      expect(typeof ollamaModel).toBe('string');
    });
  });
});
