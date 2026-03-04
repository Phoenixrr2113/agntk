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
      return { blocked: true, text: filteredText, results };

    case 'retry':
      return { blocked: true, text, results };

    default:
      throw new GuardrailBlockedError(phase, results);
  }
}

export function buildRetryFeedback(results: GuardrailResult[]): string {
  const failed = results.filter((r) => !r.passed);
  const lines = failed.map((r) => `- [${r.name}]: ${r.message ?? 'blocked'}`);
  return (
    '\n\n[GUARDRAIL FEEDBACK] Your previous response was blocked. Please regenerate, addressing:\n' +
    lines.join('\n')
  );
}

export function wrapWithGuardrails<T extends { text: string }>(
  generateFn: (input: { prompt: string }) => Promise<T>,
  config: GuardrailsConfig,
): (input: { prompt: string }) => Promise<T> {
  const {
    input: inputGuards = [],
    output: outputGuards = [],
    onBlock = 'throw',
    maxRetries = 2,
  } = config;

  return async (input: { prompt: string }) => {
    if (inputGuards.length > 0) {
      const { results: inputResults, filteredText: inputFiltered } = await runGuardrails(
        inputGuards,
        input.prompt,
        {
          prompt: input.prompt,
          phase: 'input',
        },
      );

      const inputCheck = handleGuardrailResults(
        inputResults,
        input.prompt,
        inputFiltered,
        'input',
        onBlock,
      );
      if (inputCheck.blocked && onBlock === 'filter') {
        input = { prompt: inputCheck.text };
      }

      if (inputCheck.blocked && onBlock === 'retry') {
        throw new GuardrailBlockedError('input', inputResults);
      }
    }

    let lastResult: T | undefined;
    let attempts = 0;
    let currentPrompt = input.prompt;

    while (attempts <= maxRetries) {
      lastResult = await generateFn({ prompt: currentPrompt });

      if (outputGuards.length === 0) {
        return lastResult;
      }

      const { results: outputResults, filteredText: outputFiltered } = await runGuardrails(
        outputGuards,
        lastResult.text,
        {
          prompt: input.prompt,
          phase: 'output',
        },
      );

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

        currentPrompt = input.prompt + buildRetryFeedback(outputResults);
        log.info('Retrying with guardrail feedback', { attempt: attempts, maxRetries });
        continue;
      }

      break;
    }

    if (!lastResult) {
      throw new GuardrailBlockedError('output', []);
    }
    return lastResult;
  };
}
