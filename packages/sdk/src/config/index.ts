/**
 * @fileoverview Configuration module index.
 * Exports types, schemas, and utilities for agent configuration.
 *
 * This entry point provides access to everything needed for
 * defining, loading, and accessing configuration with type safety.
 */

export {
  type AgentConfig,
  type PartialAgentConfig,
  type ModelsConfig,
  type RoleConfig,
  type ModelTier,
  type Provider,
  type CustomProvider,
  AgentConfigSchema,
  PartialAgentConfigSchema,
  ModelsConfigSchema,
  ModelTierSchema,
  ProviderSchema,
  CustomProviderSchema,
} from './schema';

export {
  loadConfig,
  getConfig,
  configure,
  resetConfig,
  getModelForTier,
  defineConfig,
  getToolConfig,
  getServerConfig,
  getClientConfig,
} from './loader';

export {
  DEFAULT_MODELS,
  DEFAULT_PROVIDER,
  DEFAULT_MAX_STEPS,
  DEFAULT_WORKSPACE_ROOT,
} from './defaults';
