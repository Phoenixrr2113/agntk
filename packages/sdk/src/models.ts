import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createLogger } from '@agntk/logger';
import { getModelForTier, getConfig, DEFAULT_MODELS, DEFAULT_PROVIDER } from './config';
import { isUsableSize } from './system-detect';
import type { LanguageModel } from 'ai';

const log = createLogger('@agntk/core:models');

interface ProviderConfig {
  name: string;
  baseURL: string;
  apiKeyEnv: string;
  headers?: Record<string, string>;
}

const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  openrouter: {
    name: 'openrouter',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
  },
  ollama: {
    name: 'ollama',

    baseURL:
      (process.env['OLLAMA_BASE_URL'] || 'http://localhost:11434').replace(/\/(api|v1)\/?$/, '') +
      '/v1',
    apiKeyEnv: 'OLLAMA_API_KEY', // Ollama typically doesn't need a key, but support it
  },
  openai: {
    name: 'openai',
    baseURL: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
  },
  cerebras: {
    name: 'cerebras',
    baseURL: 'https://api.cerebras.ai/v1',
    apiKeyEnv: 'CEREBRAS_API_KEY',
  },
  'agntk-free': {
    name: 'agntk-free',
    baseURL: 'https://api.agntk.dev/api/v1',
    apiKeyEnv: 'AGNTK_FREE_TIER_KEY',
  },
};

const providerInstances = new Map<string, ReturnType<typeof createOpenAICompatible>>();

function getProvider(providerName: string): ReturnType<typeof createOpenAICompatible> {
  let instance = providerInstances.get(providerName);
  if (instance) return instance;

  const config = getConfig();
  const customProviders = config.models?.customProviders;
  const customConfig = customProviders?.[providerName];

  let providerConfig: ProviderConfig;

  if (customConfig) {
    providerConfig = {
      name: providerName,
      baseURL: customConfig.baseURL,
      apiKeyEnv: customConfig.apiKeyEnv,
      headers: customConfig.headers,
    };
  } else if (PROVIDER_CONFIGS[providerName]) {
    providerConfig = PROVIDER_CONFIGS[providerName];
  } else {
    throw new Error(`Unknown provider: ${providerName}. Configure it in models.customProviders.`);
  }

  const apiKey =
    providerConfig.name === 'agntk-free'
      ? 'agntk-free-v1'
      : process.env[providerConfig.apiKeyEnv] || '';

  log.debug('Initializing provider', {
    name: providerConfig.name,
    baseURL: providerConfig.baseURL,
  });

  instance = createOpenAICompatible({
    name: providerConfig.name,
    baseURL: providerConfig.baseURL,
    apiKey,
    headers: providerConfig.headers,
  });

  providerInstances.set(providerName, instance);
  return instance;
}

export type ModelTier = 'fast' | 'standard' | 'reasoning' | 'powerful';
export type ModelProvider =
  | 'openrouter'
  | 'ollama'
  | 'openai'
  | 'cerebras'
  | 'agntk-free'
  | (string & {});

export interface ResolvedProvider {
  provider: string;
  source: string;
  isFree: boolean;

  ollamaModels?: {
    tier: string;
    fast: string;
    standard: string;
    reasoning: string;
    powerful: string;
    reason: string;
  };

  ollamaInstalledModels?: string[];

  ollamaSkipReason?: string;
}

let _resolvedProvider: ResolvedProvider | null = null;

export function setResolvedProvider(resolved: ResolvedProvider): void {
  _resolvedProvider = resolved;
  log.info('Provider set', { provider: resolved.provider, source: resolved.source });
}

export function getResolvedProviderState(): ResolvedProvider | null {
  return _resolvedProvider;
}

export interface ModelConfig {
  provider: ModelProvider;
  name: string;
}

function getEnvModel(tier: ModelTier): string | undefined {
  const envKey = `MODEL_${tier.toUpperCase()}`;
  return process.env[envKey];
}

function getOllamaEnvModel(tier: ModelTier): string | undefined {
  const envKey = `OLLAMA_${tier.toUpperCase()}_MODEL`;
  return process.env[envKey];
}

function createModelForProvider(provider: string, modelName: string): LanguageModel {
  const providerInstance = getProvider(provider);
  return providerInstance(modelName);
}

function createTierModel(tier: ModelTier): LanguageModel {
  if (_resolvedProvider) {
    const providerName = _resolvedProvider.provider;
    const ollamaRecommended = _resolvedProvider.ollamaModels;

    let ollamaEnvModel: string | undefined;
    if (providerName === 'ollama') {
      const envVal = getOllamaEnvModel(tier);
      const installed = _resolvedProvider.ollamaInstalledModels;
      const isInstalled = (m: string) =>
        !installed || installed.some((i) => i.startsWith(m.toLowerCase()));

      if (envVal && isUsableSize(envVal) && isInstalled(envVal)) {
        ollamaEnvModel = envVal;
      } else if (envVal) {
        const reasons: string[] = [];
        if (!isUsableSize(envVal)) reasons.push('too small (need 8b+)');
        if (!isInstalled(envVal)) reasons.push('not installed');
        log.warn(`Ignoring OLLAMA_${tier.toUpperCase()}_MODEL=${envVal} (${reasons.join(', ')})`);
      }
    }

    const modelName =
      getEnvModel(tier) ||
      ollamaEnvModel ||
      (providerName === 'ollama' && ollamaRecommended ? ollamaRecommended[tier] : undefined) ||
      DEFAULT_MODELS[providerName as keyof typeof DEFAULT_MODELS]?.[tier] ||
      DEFAULT_MODELS[DEFAULT_PROVIDER][tier];
    return createModelForProvider(providerName, modelName);
  }

  if (process.env['OLLAMA_ENABLED'] === 'true') {
    const modelName = getOllamaEnvModel(tier) || DEFAULT_MODELS.ollama[tier];
    return createModelForProvider('ollama', modelName);
  }

  const modelName = getEnvModel(tier) || DEFAULT_MODELS.openrouter[tier];
  return createModelForProvider('openrouter', modelName);
}

export const models = {
  fast: (): LanguageModel => createTierModel('fast'),
  standard: (): LanguageModel => createTierModel('standard'),
  reasoning: (): LanguageModel => createTierModel('reasoning'),
  powerful: (): LanguageModel => createTierModel('powerful'),
} as const;

export interface ModelResolutionOptions {
  tier?: ModelTier;

  provider?: ModelProvider;

  modelName?: string;
}

export interface ResolvedModel {
  model: LanguageModel;
  modelId: string;
}

export function resolveModel(options: ModelResolutionOptions = {}): ResolvedModel {
  const { tier = 'standard', provider, modelName } = options;
  const config = getConfig();

  if (modelName && provider) {
    log.info('Resolving model (explicit)', { provider, modelName });
    return { model: createModelForProvider(provider, modelName), modelId: modelName };
  }

  if (modelName && modelName.includes('/')) {
    log.info('Resolving model (OpenRouter format)', { modelName });
    return { model: createModelForProvider('openrouter', modelName), modelId: modelName };
  }

  const effectiveProvider =
    provider ?? _resolvedProvider?.provider ?? config.models?.defaultProvider ?? DEFAULT_PROVIDER;

  let effectiveModel: string;
  if (effectiveProvider === 'ollama' && _resolvedProvider?.ollamaModels) {
    const ollamaEnvModel = getOllamaEnvModel(tier);
    const installed = _resolvedProvider.ollamaInstalledModels;
    const isInstalled = (m: string) =>
      !installed || installed.some((i) => i.startsWith(m.toLowerCase()));

    if (ollamaEnvModel && isUsableSize(ollamaEnvModel) && isInstalled(ollamaEnvModel)) {
      effectiveModel = ollamaEnvModel;
    } else {
      if (ollamaEnvModel) {
        const reasons: string[] = [];
        if (!isUsableSize(ollamaEnvModel)) reasons.push('too small (need 8b+)');
        if (!isInstalled(ollamaEnvModel)) reasons.push('not installed');
        log.warn(
          `Ignoring OLLAMA_${tier.toUpperCase()}_MODEL=${ollamaEnvModel} (${reasons.join(', ')})`,
        );
      }
      effectiveModel =
        _resolvedProvider.ollamaModels[
          tier as keyof Pick<
            typeof _resolvedProvider.ollamaModels,
            'fast' | 'standard' | 'reasoning' | 'powerful'
          >
        ] || getModelForTier(tier, effectiveProvider);
    }
  } else {
    effectiveModel = getModelForTier(tier, effectiveProvider);
  }

  log.info('Resolving model (tier-based)', {
    tier,
    provider: effectiveProvider,
    model: effectiveModel,
  });
  return {
    model: createModelForProvider(effectiveProvider, effectiveModel),
    modelId: effectiveModel,
  };
}
