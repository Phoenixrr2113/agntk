import type { ToolSet, StepResult } from 'ai';

export interface UsageLimits {
  maxRequests?: number;

  maxInputTokens?: number;

  maxOutputTokens?: number;

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
