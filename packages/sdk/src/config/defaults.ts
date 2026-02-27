/**
 * @fileoverview Default configuration values.
 * These are the built-in fallbacks when no config/env is set.
 */

import type { ModelTier, Provider } from './schema';

// ============================================================================
// Default Models
// ============================================================================

export const DEFAULT_PROVIDER: Provider = 'openrouter';

export const DEFAULT_MODELS: Record<Provider, Record<ModelTier, string>> = {
  openrouter: {
    fast: 'x-ai/grok-4.1-fast',
    standard: 'google/gemini-3-flash-preview',
    reasoning: 'deepseek/deepseek-r1',
    powerful: 'z-ai/glm-4.7',
  },
  ollama: {
    fast: 'qwen3:8b',
    standard: 'qwen3:14b',
    reasoning: 'qwen3:14b',
    powerful: 'qwen3:32b',
  },
  openai: {
    fast: 'gpt-4o-mini',
    standard: 'gpt-4o',
    reasoning: 'o3',
    powerful: 'gpt-4o',
  },
  cerebras: {
    fast: 'llama-4-scout-17b-16e-instruct',
    standard: 'gpt-oss-120b',
    reasoning: 'gpt-oss-120b',
    powerful: 'qwen3-235b',
  },
  'agntk-free': {
    fast: 'gpt-oss-120b',
    standard: 'gpt-oss-120b',
    reasoning: 'gpt-oss-120b',
    powerful: 'gpt-oss-120b',
  },
};

// ============================================================================
// Default Agent Settings
// ============================================================================

export const DEFAULT_MAX_STEPS = 10;
export const DEFAULT_WORKSPACE_ROOT = process.cwd();
