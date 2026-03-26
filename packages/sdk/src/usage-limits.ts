import type { ToolSet, StepResult } from 'ai';

/**
 * Token and request budget caps for an agent run.
 *
 * All fields are optional — omitting a field means that dimension is
 * unconstrained.  At least one field should be set to have any effect.
 */
export interface UsageLimits {
  /** Maximum number of LLM API calls (steps) across the entire run. */
  maxRequests?: number;

  /** Maximum cumulative prompt tokens across all steps. */
  maxInputTokens?: number;

  /** Maximum cumulative completion tokens across all steps. */
  maxOutputTokens?: number;

  /** Maximum cumulative total tokens (input + output) across all steps. */
  maxTotalTokens?: number;
}

export type UsageLimitType =
  | 'maxRequests'
  | 'maxInputTokens'
  | 'maxOutputTokens'
  | 'maxTotalTokens';

export interface UsageSnapshot {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/**
 * Thrown (not returned) by the stop-condition function created by
 * {@link usageLimitStop} when a configured budget is exceeded.
 *
 * Callers can catch this to distinguish a budget-exceeded stop from a normal
 * agent completion.
 *
 * @example
 * ```ts
 * try {
 *   await agent.stream({ prompt });
 * } catch (err) {
 *   if (err instanceof UsageLimitExceeded) {
 *     console.error(`Limit hit: ${err.limitType} = ${err.currentValue}`);
 *   }
 * }
 * ```
 */
export class UsageLimitExceeded extends Error {
  override readonly name = 'UsageLimitExceeded';
  readonly limitType: UsageLimitType;
  readonly limitValue: number;
  readonly currentValue: number;
  readonly usage: UsageSnapshot;

  constructor(
    limitType: UsageLimitType,
    limitValue: number,
    currentValue: number,
    usage: UsageSnapshot,
  ) {
    super(`Usage limit exceeded: ${limitType} = ${currentValue} (limit: ${limitValue})`);
    this.limitType = limitType;
    this.limitValue = limitValue;
    this.currentValue = currentValue;
    this.usage = usage;
  }
}

/**
 * Creates a stop-condition function compatible with the AI SDK's
 * `ToolLoopAgent` `stopWhen` option.
 *
 * When any configured limit is exceeded the function **throws**
 * {@link UsageLimitExceeded} rather than returning `true`, so the agent loop
 * terminates immediately with a clear diagnostic error.
 *
 * @param limits - The budget caps to enforce.
 * @returns A stop-condition callback that inspects cumulative usage after each
 *   step and throws if any limit is surpassed.
 *
 * @example
 * ```ts
 * const stop = usageLimitStop({ maxInputTokens: 100_000, maxRequests: 20 });
 * const agent = new ToolLoopAgent({ stopWhen: [stop], ... });
 * ```
 */
export function usageLimitStop<TOOLS extends ToolSet>(
  limits: UsageLimits,
): (options: { steps: Array<StepResult<TOOLS>> }) => boolean {
  return ({ steps }) => {
    const usage = computeUsage(steps);

    if (limits.maxRequests !== undefined && usage.requests > limits.maxRequests) {
      throw new UsageLimitExceeded('maxRequests', limits.maxRequests, usage.requests, usage);
    }

    if (limits.maxInputTokens !== undefined && usage.inputTokens > limits.maxInputTokens) {
      throw new UsageLimitExceeded(
        'maxInputTokens',
        limits.maxInputTokens,
        usage.inputTokens,
        usage,
      );
    }

    if (limits.maxOutputTokens !== undefined && usage.outputTokens > limits.maxOutputTokens) {
      throw new UsageLimitExceeded(
        'maxOutputTokens',
        limits.maxOutputTokens,
        usage.outputTokens,
        usage,
      );
    }

    if (limits.maxTotalTokens !== undefined && usage.totalTokens > limits.maxTotalTokens) {
      throw new UsageLimitExceeded(
        'maxTotalTokens',
        limits.maxTotalTokens,
        usage.totalTokens,
        usage,
      );
    }

    return false;
  };
}

function computeUsage<TOOLS extends ToolSet>(steps: Array<StepResult<TOOLS>>): UsageSnapshot {
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;

  for (const step of steps) {
    inputTokens += step.usage?.inputTokens ?? 0;
    outputTokens += step.usage?.outputTokens ?? 0;
    totalTokens += step.usage?.totalTokens ?? 0;
  }

  return {
    requests: steps.length,
    inputTokens,
    outputTokens,
    totalTokens,
  };
}
