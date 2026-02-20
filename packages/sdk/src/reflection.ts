/**
 * @agntk/core - Reflection Strategies
 *
 * Implements reflection strategies that inject goal-state prompts between
 * agent steps, improving multi-step task completion (+27.7% success in research).
 *
 * Uses the AI SDK's `prepareStep` hook to augment the system prompt with
 * reflection instructions — no extra LLM calls required.
 */

import type { Tool, StepResult } from 'ai';

// ============================================================================
// Types
// ============================================================================

/** Available reflection strategies. */
export type ReflectionStrategy = 'none' | 'reflact' | 'periodic';

/** Configuration for the reflection system. */
export interface ReflectionConfig {
  /** Which strategy to use. Default: 'none' */
  strategy: ReflectionStrategy;

  /** For 'periodic' strategy: reflect every N steps. Default: 3 */
  frequency?: number;

  /** Custom reflection prompt template. Uses {goal} placeholder. */
  promptTemplate?: string;
}

/** Input to the prepareStep hook from the AI SDK. */
export interface PrepareStepInput<TOOLS extends Record<string, Tool> = Record<string, Tool>> {
  steps: Array<StepResult<TOOLS>>;
  stepNumber: number;
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_FREQUENCY = 3;

const DEFAULT_REFLACT_TEMPLATE = `<reflection>
Before proceeding, reflect on your progress:
1. What is the user's original goal?
2. What have you accomplished so far?
3. What is the most important next action to take?
4. Are you on track, or do you need to adjust your approach?
</reflection>`;

const DEFAULT_PERIODIC_TEMPLATE = `<reflection>
Checkpoint — pause and evaluate:
1. Revisit the user's original request. Are you still aligned with their goal?
2. Summarize what you have done so far.
3. Identify any dead ends or wasted steps.
4. Plan your next 2-3 actions to reach completion efficiently.
</reflection>`;

// ============================================================================
// Reflection Builder
// ============================================================================

/**
 * Build a reflection prompt for the given step, or return undefined if
 * no reflection should be injected at this step.
 */
export function buildReflectionPrompt(
  config: ReflectionConfig,
  stepNumber: number,
): string | undefined {
  const { strategy } = config;

  if (strategy === 'none') {
    return undefined;
  }

  if (strategy === 'reflact') {
    // reflact: inject after every step except the first (step 0 = initial call)
    if (stepNumber === 0) return undefined;
    return config.promptTemplate ?? DEFAULT_REFLACT_TEMPLATE;
  }

  if (strategy === 'periodic') {
    const frequency = config.frequency ?? DEFAULT_FREQUENCY;
    // Inject at step N, 2N, 3N... (never step 0)
    if (stepNumber === 0 || stepNumber % frequency !== 0) return undefined;
    return config.promptTemplate ?? DEFAULT_PERIODIC_TEMPLATE;
  }

  return undefined;
}

/**
 * Create a `prepareStep` function for the AI SDK that injects reflection
 * prompts into the system message at appropriate steps.
 *
 * @param baseSystem - The original system prompt, or a getter that returns
 *   the current system prompt. Use a getter (`() => prompt`) when the prompt
 *   is mutated after creation (e.g. memory injection during ensureInit) so
 *   that reflection always uses the latest value (fixes DESIGN-001 race).
 * @param config - The reflection configuration.
 * @returns A prepareStep function compatible with AI SDK's ToolLoopAgent.
 */
export function createReflectionPrepareStep<TOOLS extends Record<string, Tool> = Record<string, Tool>>(
  baseSystem: string | (() => string),
  config: ReflectionConfig,
): (input: PrepareStepInput<TOOLS>) => { system?: string } | undefined {
  // If no reflection, return a no-op
  if (config.strategy === 'none') {
    return () => undefined;
  }

  return ({ stepNumber }) => {
    const reflection = buildReflectionPrompt(config, stepNumber);
    if (!reflection) return undefined;

    // Resolve base system at call-time so memory/context injected after
    // createReflectionPrepareStep() is called is always picked up.
    const base = typeof baseSystem === 'function' ? baseSystem() : baseSystem;

    return {
      system: `${base}\n\n${reflection}`,
    };
  };
}

/**
 * Estimate the token overhead of a reflection injection.
 * Rough estimate: ~4 chars per token for English text.
 */
export function estimateReflectionTokens(config: ReflectionConfig): number {
  const template = config.strategy === 'reflact'
    ? (config.promptTemplate ?? DEFAULT_REFLACT_TEMPLATE)
    : config.strategy === 'periodic'
    ? (config.promptTemplate ?? DEFAULT_PERIODIC_TEMPLATE)
    : '';
  // ~4 chars per token, rough estimate
  return Math.ceil(template.length / 4);
}
