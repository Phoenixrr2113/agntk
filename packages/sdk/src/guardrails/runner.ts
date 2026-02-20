/**
 * @fileoverview Guardrail runner with parallel execution and fast-fail.
 */

import { createLogger } from '@agntk/logger';
import type {
  Guardrail,
  GuardrailResult,
  GuardrailContext,
  GuardrailsConfig,
  OnBlockAction,
} from './types';
import { GuardrailBlockedError } from './types';

const log = createLogger('@agntk/core:guardrails');

// ============================================================================
// Parallel Runner
// ============================================================================

/**
 * Run guardrails sequentially so each filter operates on the previous filter's output.
 *
 * This prevents a bug where parallel execution causes each guardrail to produce
 * `.filtered` from the original text independently — if guardrail A redacts PII
 * and guardrail B truncates, the truncated version could leak PII because B never
 * saw A's redaction.
 *
 * Sequential execution ensures filter composition: A redacts → B truncates the
 * already-redacted text.
 */
export async function runGuardrails(
  guardrails: Guardrail[],
  text: string,
  context: GuardrailContext,
): Promise<{ results: GuardrailResult[]; filteredText: string }> {
  if (guardrails.length === 0) return { results: [], filteredText: text };

  const results: GuardrailResult[] = [];
  let currentText = text;

  for (const guard of guardrails) {
    try {
      const result = await guard.check(currentText, context);
      results.push(result);
      // Chain: each filter operates on the previous filter's output
      if (!result.passed && result.filtered) {
        currentText = result.filtered;
      }
    } catch (error) {
      log.error('Guardrail threw', { name: guard.name, error: String(error) });
      results.push({
        passed: false,
        name: guard.name,
        message: `Guardrail error: ${error instanceof Error ? error.message : String(error)}`,
      } satisfies GuardrailResult);
    }
  }

  return { results, filteredText: currentText };
}

/**
 * Check guardrail results and handle the onBlock action.
 *
 * @param filteredText - The text after all guardrail filters have been applied sequentially.
 * @returns The (possibly filtered) text, or throws if blocked.
 */
export function handleGuardrailResults(
  results: GuardrailResult[],
  text: string,
  filteredText: string,
  phase: 'input' | 'output',
  onBlock: OnBlockAction,
): { blocked: boolean; text: string; results: GuardrailResult[] } {
  const allPassed = results.every((r) => r.passed);

  if (allPassed) {
    return { blocked: false, text, results };
  }

  log.info('Guardrail blocked', {
    phase,
    onBlock,
    failed: results.filter((r) => !r.passed).map((r) => r.name),
  });

  switch (onBlock) {
    case 'throw':
      throw new GuardrailBlockedError(phase, results);

    case 'filter':
      // filteredText already has all guardrail filters applied in sequence
      return { blocked: true, text: filteredText, results };

    case 'retry':
      // Signal that a retry is needed — caller handles the retry loop
      return { blocked: true, text, results };

    default:
      throw new GuardrailBlockedError(phase, results);
  }
}

// ============================================================================
// Agent Wrapper
// ============================================================================

/**
 * Build a guardrail feedback message for retry attempts.
 * This is appended to the prompt when retrying after an output guardrail failure.
 */
export function buildRetryFeedback(results: GuardrailResult[]): string {
  const failed = results.filter((r) => !r.passed);
  const lines = failed.map((r) => `- [${r.name}]: ${r.message ?? 'blocked'}`);
  return (
    '\n\n[GUARDRAIL FEEDBACK] Your previous response was blocked. Please regenerate, addressing:\n' +
    lines.join('\n')
  );
}

/**
 * Wrap an agent's generate function with guardrail checks.
 *
 * Input guardrails run before the agent; output guardrails run after.
 * Both phases run their guardrails in parallel.
 */
export function wrapWithGuardrails<T extends { text: string }>(
  generateFn: (input: { prompt: string }) => Promise<T>,
  config: GuardrailsConfig,
): (input: { prompt: string }) => Promise<T> {
  const { input: inputGuards = [], output: outputGuards = [], onBlock = 'throw', maxRetries = 2 } = config;

  return async (input: { prompt: string }) => {
    // ─── Input Guardrails ───────────────────────────────────────────────
    if (inputGuards.length > 0) {
      const { results: inputResults, filteredText: inputFiltered } = await runGuardrails(inputGuards, input.prompt, {
        prompt: input.prompt,
        phase: 'input',
      });

      const inputCheck = handleGuardrailResults(inputResults, input.prompt, inputFiltered, 'input', onBlock);
      if (inputCheck.blocked && onBlock === 'filter') {
        input = { prompt: inputCheck.text };
      }
      // If onBlock is 'retry' for input, we just throw (can't retry user input)
      if (inputCheck.blocked && onBlock === 'retry') {
        throw new GuardrailBlockedError('input', inputResults);
      }
    }

    // ─── Agent Execution + Output Guardrails ────────────────────────────
    let lastResult: T | undefined;
    let attempts = 0;
    let currentPrompt = input.prompt;

    while (attempts <= maxRetries) {
      lastResult = await generateFn({ prompt: currentPrompt });

      if (outputGuards.length === 0) {
        return lastResult;
      }

      const { results: outputResults, filteredText: outputFiltered } = await runGuardrails(outputGuards, lastResult.text, {
        prompt: input.prompt,
        phase: 'output',
      });

      const outputCheck = handleGuardrailResults(
        outputResults,
        lastResult.text,
        outputFiltered,
        'output',
        onBlock,
      );

      if (!outputCheck.blocked) {
        return lastResult;
      }

      if (onBlock === 'filter') {
        return { ...lastResult, text: outputCheck.text };
      }

      if (onBlock === 'retry') {
        attempts++;
        if (attempts > maxRetries) {
          throw new GuardrailBlockedError('output', outputResults);
        }
        // Append guardrail feedback for the retry
        currentPrompt = input.prompt + buildRetryFeedback(outputResults);
        log.info('Retrying with guardrail feedback', { attempt: attempts, maxRetries });
        continue;
      }

      // onBlock === 'throw' is handled inside handleGuardrailResults
      break;
    }

    // E-2: Guard against undefined lastResult (reachable when maxRetries=0 and output blocked)
    if (!lastResult) {
      throw new GuardrailBlockedError('output', []);
    }
    return lastResult;
  };
}
