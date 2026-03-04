import type { LanguageModel } from 'ai';
import type { Assertion, EvalAgentResult } from './types';

export function toolCalled(toolName: string): Assertion {
  return {
    name: `toolCalled(${toolName})`,
    check: (result) => {
      const called = result.steps.some((step) =>
        step.toolCalls?.some((tc) => tc.toolName === toolName),
      );
      return {
        name: `toolCalled(${toolName})`,
        passed: called,
        message: called ? undefined : `Tool '${toolName}' was not called`,
      };
    },
  };
}

export function noToolCalled(toolName: string): Assertion {
  return {
    name: `noToolCalled(${toolName})`,
    check: (result) => {
      const called = result.steps.some((step) =>
        step.toolCalls?.some((tc) => tc.toolName === toolName),
      );
      return {
        name: `noToolCalled(${toolName})`,
        passed: !called,
        message: called ? `Tool '${toolName}' was unexpectedly called` : undefined,
      };
    },
  };
}

export function toolCalledTimes(toolName: string, expectedCount: number): Assertion {
  return {
    name: `toolCalledTimes(${toolName}, ${expectedCount})`,
    check: (result) => {
      let count = 0;
      for (const step of result.steps) {
        if (step.toolCalls) {
          count += step.toolCalls.filter((tc) => tc.toolName === toolName).length;
        }
      }
      return {
        name: `toolCalledTimes(${toolName}, ${expectedCount})`,
        passed: count === expectedCount,
        message:
          count !== expectedCount ? `Expected ${expectedCount} calls, got ${count}` : undefined,
      };
    },
  };
}

export function outputMatches(pattern: RegExp): Assertion {
  return {
    name: `outputMatches(${pattern})`,
    check: (result) => {
      const matches = pattern.test(result.text);
      return {
        name: `outputMatches(${pattern})`,
        passed: matches,
        message: matches ? undefined : `Output did not match ${pattern}`,
      };
    },
  };
}

export function outputContains(text: string): Assertion {
  return {
    name: `outputContains("${text.slice(0, 30)}")`,
    check: (result) => {
      const contains = result.text.includes(text);
      return {
        name: `outputContains("${text.slice(0, 30)}")`,
        passed: contains,
        message: contains ? undefined : `Output does not contain "${text.slice(0, 50)}"`,
      };
    },
  };
}

export function stepCount(min: number, max?: number): Assertion {
  const desc = max !== undefined ? `stepCount(${min}-${max})` : `stepCount(>=${min})`;
  return {
    name: desc,
    check: (result) => {
      const count = result.steps.length;
      const inRange = max !== undefined ? count >= min && count <= max : count >= min;
      return {
        name: desc,
        passed: inRange,
        message: inRange ? undefined : `Step count ${count} not in range [${min}, ${max ?? '∞'}]`,
      };
    },
  };
}

export function tokenUsage(maxTokens: number): Assertion {
  return {
    name: `tokenUsage(<=${maxTokens})`,
    check: (result) => {
      const total = result.totalUsage.totalTokens ?? 0;
      const withinBudget = total <= maxTokens;
      return {
        name: `tokenUsage(<=${maxTokens})`,
        passed: withinBudget,
        message: withinBudget ? undefined : `Total tokens ${total} exceeds budget ${maxTokens}`,
      };
    },
  };
}

export function llmJudge(options: {
  model: LanguageModel;
  criteria: string;
  name?: string;
}): Assertion {
  const { model, criteria, name: assertionName } = options;
  return {
    name: assertionName ?? `llmJudge("${criteria.slice(0, 30)}")`,
    check: async (result) => {
      try {
        const { generateText } = await import('ai');
        const judgeResult = await generateText({
          model,
          prompt: `You are an evaluation judge. Given an agent's output, determine if it meets the criteria.

Criteria: ${criteria}

Agent output:
${result.text.slice(0, 2000)}

Respond with EXACTLY one line: "PASS" or "FAIL: <reason>"`,
          maxOutputTokens: 200,
        });

        const verdict = judgeResult.text.trim();
        const passed = verdict.startsWith('PASS');
        return {
          name: assertionName ?? `llmJudge("${criteria.slice(0, 30)}")`,
          passed,
          message: passed ? undefined : verdict,
        };
      } catch (error) {
        return {
          name: assertionName ?? `llmJudge("${criteria.slice(0, 30)}")`,
          passed: false,
          message: `LLM judge failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}

export function custom(
  name: string,
  checkFn: (result: EvalAgentResult) => boolean | { passed: boolean; message?: string },
): Assertion {
  return {
    name,
    check: (result) => {
      const outcome = checkFn(result);
      if (typeof outcome === 'boolean') {
        return { name, passed: outcome };
      }
      return { name, ...outcome };
    },
  };
}
