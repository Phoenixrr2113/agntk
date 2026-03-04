import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadConfig,
  resetConfig,
  getConfig,
  configure,
  getModelForTier,
  defineConfig,
} from '../loader';
import { DEFAULT_PROVIDER, DEFAULT_MODELS } from '../defaults';

describe('Config Loader', () => {
  beforeEach(() => {
    resetConfig();

    delete process.env['AGENT_SDK_MODEL_FAST'];
    delete process.env['AGENT_SDK_MODEL_POWERFUL'];
    delete process.env['AGENT_SDK_DEFAULT_PROVIDER'];
  });

  afterEach(() => {
    resetConfig();
  });

  describe('loadConfig', () => {
    it('should return defaults when no config file exists', () => {
      const config = loadConfig('/nonexistent/path');
      expect(config.models?.defaultProvider).toBe(DEFAULT_PROVIDER);
    });

    it('should use default provider when not specified', () => {
      const config = loadConfig();
      expect(config.models?.defaultProvider).toBe(DEFAULT_PROVIDER);
    });
  });

  describe('getConfig', () => {
    it('should return cached config on subsequent calls', () => {
      const config1 = getConfig();
      const config2 = getConfig();
      expect(config1).toBe(config2);
    });
  });

  describe('configure', () => {
    it('should merge options with existing config', () => {
      configure({ maxSteps: 50 });
      const config = getConfig();
      expect(config.maxSteps).toBe(50);
    });

    it('should deep merge nested objects', () => {
      configure({ models: { tiers: { fast: 'custom-fast' } } });
      const config = getConfig();
      expect(config.models?.tiers?.fast).toBe('custom-fast');
    });
  });

  describe('getModelForTier', () => {
    it('should return default model for tier', () => {
      const model = getModelForTier('fast');
      expect(model).toBe(DEFAULT_MODELS.openrouter.fast);
    });

    it('should respect env var override', () => {
      process.env['AGENT_SDK_MODEL_POWERFUL'] = 'custom/model';
      resetConfig();
      const model = getModelForTier('powerful');
      expect(model).toBe('custom/model');
    });

    it('should respect configured tier override', () => {
      configure({ models: { tiers: { standard: 'my-standard-model' } } });
      const model = getModelForTier('standard');
      expect(model).toBe('my-standard-model');
    });

    it('should use provider-specific model when available', () => {
      const model = getModelForTier('fast', 'ollama');
      expect(model).toBe(DEFAULT_MODELS.ollama.fast);
    });
  });

  describe('defineConfig', () => {
    it('should return the same config (helper for config files)', () => {
      const config = defineConfig({ maxSteps: 10 });
      expect(config.maxSteps).toBe(10);
    });
  });
});
