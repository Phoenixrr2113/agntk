import type { ModelTier, Provider } from './schema';

export const DEFAULT_PROVIDER: Provider = 'openrouter';

export const DEFAULT_MODELS: Record<Provider, Record<ModelTier, string>> = {
  openrouter: {
    fast: 'xiaomi/mimo-v2-flash',
    standard: 'deepseek/deepseek-v3.2',
    reasoning: 'deepseek/deepseek-r1',
    powerful: 'z-ai/glm-4.7',
  },
  ollama: {
    fast: 'qwen3.5:4b',
    standard: 'qwen3.5:9b',
    reasoning: 'qwen3.5:27b',
    powerful: 'qwen3.5:35b',
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

export const DEFAULT_MAX_STEPS = 0;
export const DEFAULT_WORKSPACE_ROOT = process.cwd();
