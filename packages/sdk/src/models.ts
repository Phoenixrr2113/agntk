/**
 * @agntk/core - Model Configuration
 *
 * Model tier definitions supporting multiple providers.
 * All providers use @ai-sdk/openai-compatible for unified access.
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createLogger } from '@agntk/logger';
import { getModelForTier, getConfig, DEFAULT_MODELS, DEFAULT_PROVIDER } from './config';
import { isUsableSize } from './system-detect';
import type { LanguageModel } from 'ai';

const log = createLogger('@agntk/core:models');

// ============================================================================
// Provider Configuration
// ============================================================================

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
    // OLLAMA_BASE_URL may be the root (http://localhost:11434) or have /api or /v1 —
    // normalize to always end with /v1 for the OpenAI-compatible endpoint.
    baseURL: ((process.env['OLLAMA_BASE_URL'] || 'http://localhost:11434').replace(/\/(api|v1)\/?$/, '')) + '/v1',
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

// ============================================================================
// Provider Instances (Lazy Initialization)
// ============================================================================

const providerInstances = new Map<string, ReturnType<typeof createOpenAICompatible>>();

function getProvider(providerName: string): ReturnType<typeof createOpenAICompatible> {
  let instance = providerInstances.get(providerName);
  if (instance) return instance;

  // Check for custom providers in config
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

  // For the free tier proxy, use a static identifier token (proxy holds the real key)
  const apiKey = providerConfig.name === 'agntk-free'
    ? 'agntk-free-v1'
    : (process.env[providerConfig.apiKeyEnv] || '');

  log.debug('Initializing provider', { name: providerConfig.name, baseURL: providerConfig.baseURL });

  instance = createOpenAICompatible({
    name: providerConfig.name,
    baseURL: providerConfig.baseURL,
    apiKey,
    headers: providerConfig.headers,
  });

  providerInstances.set(providerName, instance);
  return instance;
}

// ============================================================================
// Model Tier Types
// ============================================================================

export type ModelTier = 'fast' | 'standard' | 'reasoning' | 'powerful';
export type ModelProvider = 'openrouter' | 'ollama' | 'openai' | 'cerebras' | 'agntk-free' | (string & {});

// ============================================================================
// Resolved Provider (set once at startup by CLI/server)
// ============================================================================

export interface ResolvedProvider {
  provider: string;
  source: string;
  isFree: boolean;
  /** Hardware-aware Ollama model recommendations (when provider is 'ollama') */
  ollamaModels?: {
    tier: string;
    fast: string;
    standard: string;
    reasoning: string;
    powerful: string;
    reason: string;
  };
  /** Models actually installed in Ollama (for validating env overrides) */
  ollamaInstalledModels?: string[];
  /** When Ollama was skipped despite running, explains why (for CLI display) */
  ollamaSkipReason?: string;
}

let _resolvedProvider: ResolvedProvider | null = null;

/**
 * Set the resolved provider. Called once by the CLI after running the cascade.
 * Bridges async resolution to sync model creation functions.
 */
export function setResolvedProvider(resolved: ResolvedProvider): void {
  _resolvedProvider = resolved;
  log.info('Provider set', { provider: resolved.provider, source: resolved.source });
}

/**
 * Get the currently resolved provider, or null if not yet resolved.
 */
export function getResolvedProviderState(): ResolvedProvider | null {
  return _resolvedProvider;
}

export interface ModelConfig {
  provider: ModelProvider;
  name: string;
}

// ============================================================================
// Environment Variable Model Overrides
// ============================================================================

function getEnvModel(tier: ModelTier): string | undefined {
  const envKey = `MODEL_${tier.toUpperCase()}`;
  return process.env[envKey];
}

function getOllamaEnvModel(tier: ModelTier): string | undefined {
  const envKey = `OLLAMA_${tier.toUpperCase()}_MODEL`;
  return process.env[envKey];
}

// ============================================================================
// Model Creation Functions
// ============================================================================

function createModelForProvider(
  provider: string,
  modelName: string
): LanguageModel {
  const providerInstance = getProvider(provider);
  return providerInstance(modelName);
}

// ============================================================================
// Model Tier Functions
// ============================================================================

/**
 * Create a model for a given tier, respecting env overrides, resolved provider, and Ollama fallback.
 *
 * For Ollama providers, model selection is hardware-aware:
 * the provider resolver attaches an ollamaModels recommendation that
 * maps each tier to the largest model the system can run.
 */
function createTierModel(tier: ModelTier): LanguageModel {
  // 1. Use resolved provider if available (new zero-config path)
  if (_resolvedProvider) {
    const providerName = _resolvedProvider.provider;
    const ollamaRecommended = _resolvedProvider.ollamaModels;

    // For Ollama: env overrides must pass quality gate AND be installed.
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

    const modelName = getEnvModel(tier)
      || ollamaEnvModel
      || (providerName === 'ollama' && ollamaRecommended ? ollamaRecommended[tier] : undefined)
      || DEFAULT_MODELS[providerName as keyof typeof DEFAULT_MODELS]?.[tier]
      || DEFAULT_MODELS[DEFAULT_PROVIDER][tier];
    return createModelForProvider(providerName, modelName);
  }

  // 2. Legacy path: explicit OLLAMA_ENABLED
  if (process.env['OLLAMA_ENABLED'] === 'true') {
    const modelName = getOllamaEnvModel(tier) || DEFAULT_MODELS.ollama[tier];
    return createModelForProvider('ollama', modelName);
  }

  // 3. Legacy path: default to openrouter
  const modelName = getEnvModel(tier) || DEFAULT_MODELS.openrouter[tier];
  return createModelForProvider('openrouter', modelName);
}

export const models = {
  fast: (): LanguageModel => createTierModel('fast'),
  standard: (): LanguageModel => createTierModel('standard'),
  reasoning: (): LanguageModel => createTierModel('reasoning'),
  powerful: (): LanguageModel => createTierModel('powerful'),
};

// ============================================================================
// Model Resolution
// ============================================================================

export interface ModelResolutionOptions {
  /** Specific model tier to use */
  tier?: ModelTier;
  /** Specific provider to use */
  provider?: ModelProvider;
  /** Specific model name (overrides tier/provider) */
  modelName?: string;
}

/**
 * Resolves a model based on options.
 *
 * Priority:
 * 1. Explicit modelName with provider
 * 2. Tier-based selection from config (env vars > config file > defaults)
 * 3. Default tier (standard) with default provider
 */
export function resolveModel(options: ModelResolutionOptions = {}): LanguageModel {
  const { tier = 'standard', provider, modelName } = options;
  const config = getConfig();

  // If explicit model name provided with provider
  if (modelName && provider) {
    log.info('Resolving model (explicit)', { provider, modelName });
    return createModelForProvider(provider, modelName);
  }

  // If modelName looks like "provider/model", route through OpenRouter
  if (modelName && modelName.includes('/')) {
    log.info('Resolving model (OpenRouter format)', { modelName });
    return createModelForProvider('openrouter', modelName);
  }

  // Use tier-based selection: resolved provider (from cascade) wins over config default
  const effectiveProvider = provider ?? _resolvedProvider?.provider ?? config.models?.defaultProvider ?? DEFAULT_PROVIDER;

  // For Ollama: hardware-detected recommendation takes priority over static defaults.
  // Env overrides (OLLAMA_*_MODEL) can win if they pass both the quality gate AND
  // are actually installed — otherwise we silently fall back to the recommendation.
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
        log.warn(`Ignoring OLLAMA_${tier.toUpperCase()}_MODEL=${ollamaEnvModel} (${reasons.join(', ')})`);
      }
      effectiveModel = _resolvedProvider.ollamaModels[tier as keyof Pick<typeof _resolvedProvider.ollamaModels, 'fast' | 'standard' | 'reasoning' | 'powerful'>]
        || getModelForTier(tier, effectiveProvider);
    }
  } else {
    effectiveModel = getModelForTier(tier, effectiveProvider);
  }

  log.info('Resolving model (tier-based)', { tier, provider: effectiveProvider, model: effectiveModel });
  return createModelForProvider(effectiveProvider, effectiveModel);
}

