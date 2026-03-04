/**
 * @fileoverview Entry point for the deep-reasoning tool.
 * Exports types, constants, and the tool creation function for agentic reasoning.
 */
export { createDeepReasoningTool } from './tools';

export {
  DeepReasoningEngine,
  configureDeepReasoning,
  isDeepReasoningEnabled,
  getDeepReasoningEngine,
  resetDeepReasoningEngine,
} from './engine';

export type {
  ThoughtData,
  ReasoningResult,
  DeepReasoningConfig,
  DeepReasoningInput,
} from './types';

export {
  DEEP_REASONING_DESCRIPTION,
  UNRESTRICTED_MODE_DESCRIPTION,
  DEFAULT_MAX_HISTORY,
  DEFAULT_MAX_BRANCH_SIZE,
} from './constants';
