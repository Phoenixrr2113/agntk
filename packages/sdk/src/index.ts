/**
 * @fileoverview Main entry point for the SDK.
 */
export { createAgent, AGENT_STATE_BASE, resolveAgentStatePath } from './agent';

export type { AgentOptions, Agent, AgentStreamResult } from './types/agent';
export type { SubAgentActivityChunk, SubAgentActivityHandler } from './tools/spawn-agent';

export { resolveModel, models, setResolvedProvider, getResolvedProviderState } from './models';
export type { ResolvedProvider, ResolvedModel } from './models';

export { resolveProvider, getResolvedProvider, resetProviderCache } from './provider-resolver';

export {
  detectSystem,
  recommendOllamaModels,
  getOllamaModels,
  hasOllamaModel,
} from './system-detect';
export type { SystemProfile, OllamaModelTier, OllamaModelRecommendation } from './system-detect';

export {
  loadConfig,
  getConfig,
  configure,
  defineConfig,
  getModelForTier,
  DEFAULT_MODELS,
  DEFAULT_PROVIDER,
} from './config';
export type { AgentConfig, PartialAgentConfig, ModelsConfig, ModelTier, Provider } from './config';

export type { SkillsConfig, SkillMeta, SkillContent } from './skills';
export { loadSkills, discoverSkills } from './skills';

export { UsageLimitExceeded, usageLimitStop } from './usage-limits';
export type { UsageLimits, UsageLimitType } from './usage-limits';

export type { ApprovalConfig } from './tools/approval';
export type { GuardrailsConfig, Guardrail, GuardrailResult } from './guardrails/types';

export type { ReflectionStrategy, ReflectionConfig } from './reflection';

export type { MemoryStore, MemoryConfig } from './memory/types';
export { MarkdownMemoryStore } from './memory/store';
export type { MarkdownMemoryStoreOptions } from './memory/store';
export { loadMemoryContext } from './memory/loader';

export { shutdownObservability } from './observability';

export type {
  HarnessFrontmatter,
  CoreIdentity,
  Rule,
  Instinct,
  ParsedHarnessDocument,
  HarnessConfig,
} from './harness';
export { parseFrontmatter } from './harness';
