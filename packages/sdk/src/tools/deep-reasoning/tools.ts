/**
 * @fileoverview Implementation of the deep-reasoning tool.
 * Provides the tool definition and execution logic for structured chain-of-thought reasoning.
 */
import { tool } from 'ai';

import { createLogger } from '@agntk/logger';
import { DEEP_REASONING_DESCRIPTION, UNRESTRICTED_MODE_DESCRIPTION } from './constants';
import { getDeepReasoningEngine, isDeepReasoningEnabled } from './engine';
import { deepReasoningInputSchema, type ThoughtData } from './types';

const log = createLogger('@agntk/core:reasoning');

export function createDeepReasoningTool() {
  const description = isDeepReasoningEnabled()
    ? `${DEEP_REASONING_DESCRIPTION}\n\n${UNRESTRICTED_MODE_DESCRIPTION}`
    : DEEP_REASONING_DESCRIPTION;

  return tool({
    description,
    inputSchema: deepReasoningInputSchema,
    execute: async (input) => {
      log.debug('deep reasoning', {
        thought: (input as ThoughtData).thoughtNumber,
        total: (input as ThoughtData).totalThoughts,
      });
      const engine = getDeepReasoningEngine();
      const result = engine.processThought(input as ThoughtData);
      log.debug('deep reasoning result', { nextNeeded: result.nextThoughtNeeded });
      return JSON.stringify(result);
    },
  });
}
