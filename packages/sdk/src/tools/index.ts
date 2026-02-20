/**
 * @agntk/core - Tools Module
 *
 * Central export for tool factory, provider, and utilities.
 */

// Glob Tool
export {
  globTool,
  createGlobTool,
  runRgFiles,
  formatGlobResult,
  type GlobOptions,
  type GlobResult,
  type FileMatch,
} from './glob';

// Grep Tool
export {
  grepTool,
  createGrepTool,
  runRg,
  runRgCount,
  formatGrepResult,
  formatCountResult,
  downloadAndInstallRipgrep,
  type GrepOptions,
  type GrepMatch,
  type GrepResult,
  type CountResult,
} from './grep';

// AST-Grep Tool
export {
  astGrepSearchTool,
  astGrepReplaceTool,
  createAstGrepTools,
  runSg,
  ensureAstGrepBinary,
  formatSearchResult,
  formatReplaceResult,
  type CliLanguage,
  type CliMatch,
  type SgResult,
  type SearchMatch,
} from './ast-grep';

// Shell Tool
export {
  createShellTool,
  shellTool,
  executeShellCommand,
  addToAllowlist,
  clearAllowlist,
  getAllowlist,
  SHELL_DESCRIPTION,
  DEFAULT_TIMEOUT,
  MAX_TIMEOUT,
  INTERACTIVE_COMMANDS,
  type ShellInput,
  type ShellResult,
} from './shell';

// Plan Tool
export {
  createPlanTool,
  createValidationTool,
  runTypeCheck,
  runTestCommand,
  MAX_PLAN_STEPS,
  DELEGATION_THRESHOLD,
  PLAN_DESCRIPTION,
  VALIDATION_DESCRIPTION,
  AVAILABLE_AGENTS,
  type Plan,
  type PlanStep,
  type PlanToolConfig,
  type ScopeAssessment,
  type PendingDecision,
  type PlanInput,
  type ValidationInput,
  type ValidationResult,
} from './plan';

// Deep Reasoning Tool
export {
  createDeepReasoningTool,
  DeepReasoningEngine,
  configureDeepReasoning,
  isDeepReasoningEnabled,
  getDeepReasoningEngine,
  resetDeepReasoningEngine,
  DEEP_REASONING_DESCRIPTION,
  UNRESTRICTED_MODE_DESCRIPTION,
  DEFAULT_MAX_HISTORY,
  DEFAULT_MAX_BRANCH_SIZE,
  type ThoughtData,
  type ReasoningResult,
  type DeepReasoningConfig,
  type DeepReasoningInput,
} from './deep-reasoning';

// File Tools
export {
  createFileReadTool,
  createFileWriteTool,
  createFileEditTool,
  createFileCreateTool,
  createFileTools,
} from './file';

// Spawn Agent Tool
export { createSpawnAgentTool } from './spawn-agent';

// Model Retry
export {
  ModelRetry,
  wrapToolWithRetry,
  wrapAllToolsWithRetry,
} from './model-retry';

// Search Skills Tool
export { createSearchSkillsTool, clearSkillsCache, type SearchSkillsToolConfig } from './search-skills';

// Memory Tools
export { createMemoryTools, type MemoryToolsOptions } from '../memory/tools';
export type { MemoryStore, MemoryConfig } from '../memory/types';
export { MarkdownMemoryStore } from '../memory/store';

// Browser Tool
export {
  createBrowserTool,
  browserTool,
  executeBrowserCommand,
  buildCommand,
  isBrowserCliAvailable,
  resetCliAvailability,
  browserInputSchema,
  BROWSER_ACTIONS,
  BROWSER_TOOL_DESCRIPTION,
  type BrowserInput,
  type BrowserAction,
  type BrowserResult,
  type BrowserConfig,
} from './browser';
