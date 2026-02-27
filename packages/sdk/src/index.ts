/**
 * @agntk/core — Main entry point.
 *
 * The essentials: createAgent + supporting types.
 * Advanced features live in sub-path imports:
 *   - @agntk/core/evals      — eval suite and assertions
 *   - @agntk/core/advanced   — guardrail runners, best-of-n, observability, streaming internals
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Core — the essentials
// ═══════════════════════════════════════════════════════════════════════════════

export { createAgent } from './agent';

export type {
  AgentOptions,
  Agent,
  AgentStreamResult,
} from './types/agent';

// ═══════════════════════════════════════════════════════════════════════════════
// Models
// ═══════════════════════════════════════════════════════════════════════════════

export { resolveModel, models, setResolvedProvider, getResolvedProviderState } from './models';
export type { ResolvedProvider } from './models';

// ═══════════════════════════════════════════════════════════════════════════════
// Provider Resolution
// ═══════════════════════════════════════════════════════════════════════════════

export { resolveProvider, getResolvedProvider, resetProviderCache } from './provider-resolver';

// ═══════════════════════════════════════════════════════════════════════════════
// System Detection
// ═══════════════════════════════════════════════════════════════════════════════

export { detectSystem, recommendOllamaModels, getOllamaModels, hasOllamaModel } from './system-detect';
export type { SystemProfile, OllamaModelTier, OllamaModelRecommendation } from './system-detect';

// ═══════════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════════
// Skills
// ═══════════════════════════════════════════════════════════════════════════════

export type { SkillsConfig, SkillMeta, SkillContent } from './skills';
export { loadSkills, discoverSkills } from './skills';

// ═══════════════════════════════════════════════════════════════════════════════
// Usage Limits
// ═══════════════════════════════════════════════════════════════════════════════

export { UsageLimitExceeded, usageLimitStop } from './usage-limits';
export type { UsageLimits, UsageLimitType } from './usage-limits';

// ═══════════════════════════════════════════════════════════════════════════════
// Approval & Guardrails — types only (runners in @agntk/core/advanced)
// ═══════════════════════════════════════════════════════════════════════════════

export type { ApprovalConfig } from './tools/approval';
export type { GuardrailsConfig, Guardrail, GuardrailResult } from './guardrails/types';

// ═══════════════════════════════════════════════════════════════════════════════
// Reflection — types only (internals in @agntk/core/advanced)
// ═══════════════════════════════════════════════════════════════════════════════

export type { ReflectionStrategy, ReflectionConfig } from './reflection';

// ═══════════════════════════════════════════════════════════════════════════════
// Memory
// ═══════════════════════════════════════════════════════════════════════════════

export type { MemoryStore, MemoryConfig } from './memory/types';
export { MarkdownMemoryStore } from './memory/store';
export type { MarkdownMemoryStoreOptions } from './memory/store';
export { loadMemoryContext } from './memory/loader';

// ═══════════════════════════════════════════════════════════════════════════════
// Observability
// ═══════════════════════════════════════════════════════════════════════════════

export { shutdownObservability } from './observability';
