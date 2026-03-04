import type { Tool, StepResult } from 'ai';

export type ReflectionStrategy = 'none' | 'reflact' | 'periodic';

export interface ReflectionConfig {
  strategy: ReflectionStrategy;

  frequency?: number;

  promptTemplate?: string;
}

export interface PrepareStepInput<TOOLS extends Record<string, Tool> = Record<string, Tool>> {
  steps: Array<StepResult<TOOLS>>;
  stepNumber: number;
}

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

export function buildReflectionPrompt(
  config: ReflectionConfig,
  stepNumber: number,
): string | undefined {
  const { strategy } = config;

  if (strategy === 'none') {
    return undefined;
  }

  if (strategy === 'reflact') {
    if (stepNumber === 0) return undefined;
    return config.promptTemplate ?? DEFAULT_REFLACT_TEMPLATE;
  }

  if (strategy === 'periodic') {
    const frequency = config.frequency ?? DEFAULT_FREQUENCY;

    if (stepNumber === 0 || stepNumber % frequency !== 0) return undefined;
    return config.promptTemplate ?? DEFAULT_PERIODIC_TEMPLATE;
  }

  return undefined;
}

export function createReflectionPrepareStep<
  TOOLS extends Record<string, Tool> = Record<string, Tool>,
>(
  baseSystem: string | (() => string),
  config: ReflectionConfig,
): (input: PrepareStepInput<TOOLS>) => { system?: string } | undefined {
  if (config.strategy === 'none') {
    return () => undefined;
  }

  return ({ stepNumber }) => {
    const reflection = buildReflectionPrompt(config, stepNumber);
    if (!reflection) return undefined;

    const base = typeof baseSystem === 'function' ? baseSystem() : baseSystem;

    return {
      system: `${base}\n\n${reflection}`,
    };
  };
}

export function estimateReflectionTokens(config: ReflectionConfig): number {
  const template =
    config.strategy === 'reflact'
      ? (config.promptTemplate ?? DEFAULT_REFLACT_TEMPLATE)
      : config.strategy === 'periodic'
        ? (config.promptTemplate ?? DEFAULT_PERIODIC_TEMPLATE)
        : '';

  return Math.ceil(template.length / 4);
}
