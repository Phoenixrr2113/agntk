import { createLogger } from '@agntk/logger';
import type {
  EvalSuiteConfig,
  EvalSuiteResult,
  EvalCaseResult,
  EvalCase,
  EvalAgentResult,
  EvalReporter,
} from './types';
import type { Agent } from '../types/agent';

const log = createLogger('@agntk/core:evals');

export function createEvalSuite(config: EvalSuiteConfig) {
  const { name, agent, cases, maxConcurrency = 1, reporter: reporterConfig = 'console' } = config;

  const reporter: EvalReporter =
    typeof reporterConfig === 'string'
      ? reporterConfig === 'json'
        ? createJsonReporter()
        : createConsoleReporter()
      : reporterConfig;

  return {
    name,
    cases,

    async run(): Promise<EvalSuiteResult> {
      const startTime = Date.now();
      log.info('Starting eval suite', { name, caseCount: cases.length, maxConcurrency });

      const caseResults: EvalCaseResult[] = [];

      const queue = [...cases];
      const active: Promise<void>[] = [];

      while (queue.length > 0 || active.length > 0) {
        while (active.length < maxConcurrency && queue.length > 0) {
          const evalCase = queue.shift()!;
          const promise = runCase(agent, evalCase, reporter).then((result) => {
            caseResults.push(result);
            const idx = active.indexOf(promise);
            if (idx !== -1) active.splice(idx, 1);
          });
          active.push(promise);
        }

        if (active.length > 0) {
          await Promise.race(active);
        }
      }

      const suiteResult: EvalSuiteResult = {
        name,
        totalCases: cases.length,
        passed: caseResults.filter((r) => r.passed).length,
        failed: caseResults.filter((r) => !r.passed).length,
        duration: Date.now() - startTime,
        cases: caseResults,
      };

      reporter.onSuiteEnd?.(suiteResult);
      log.info('Eval suite complete', {
        name,
        passed: suiteResult.passed,
        failed: suiteResult.failed,
        duration: suiteResult.duration,
      });

      return suiteResult;
    },
  };
}

async function runCase(
  agent: Agent,
  evalCase: EvalCase,
  reporter: EvalReporter,
): Promise<EvalCaseResult> {
  const startTime = Date.now();
  reporter.onCaseStart?.(evalCase.name);

  try {
    const timeout = evalCase.timeout ?? 30_000;
    const streamResult = await Promise.race([
      agent.stream({ prompt: evalCase.prompt }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Eval case timed out after ${timeout}ms`)), timeout),
      ),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _chunk of streamResult.fullStream) {
      void 0;
    }
    const text = await streamResult.text;
    const usage = await streamResult.usage;

    const evalResult: EvalAgentResult = {
      text: text ?? '',
      steps: [],
      totalUsage: usage
        ? {
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
            totalTokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
          }
        : { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };

    const assertionResults = await Promise.all(
      evalCase.assertions.map((assertion) => assertion.check(evalResult)),
    );

    const allPassed = assertionResults.every((r) => r.passed);
    const result: EvalCaseResult = {
      name: evalCase.name,
      passed: allPassed,
      duration: Date.now() - startTime,
      assertions: assertionResults,
    };

    reporter.onCaseEnd?.(result);
    return result;
  } catch (error) {
    const result: EvalCaseResult = {
      name: evalCase.name,
      passed: false,
      duration: Date.now() - startTime,
      assertions: [],
      error: error instanceof Error ? error.message : String(error),
    };
    reporter.onCaseEnd?.(result);
    return result;
  }
}

function createConsoleReporter(): EvalReporter {
  return {
    onCaseStart(caseName) {
      log.info(`  Running: ${caseName}`);
    },
    onCaseEnd(result) {
      const icon = result.passed ? 'PASS' : 'FAIL';
      log.info(`  ${icon}: ${result.name} (${result.duration}ms)`);
      if (!result.passed) {
        for (const a of result.assertions) {
          if (!a.passed) {
            log.info(`    - ${a.name}: ${a.message ?? 'failed'}`);
          }
        }
        if (result.error) {
          log.info(`    Error: ${result.error}`);
        }
      }
    },
    onSuiteEnd(result) {
      log.info(
        `\n  ${result.name}: ${result.passed}/${result.totalCases} passed (${result.duration}ms)\n`,
      );
    },
  };
}

function createJsonReporter(): EvalReporter {
  return {
    onSuiteEnd(result) {
      const output = JSON.stringify(
        {
          suite: result.name,
          total: result.totalCases,
          passed: result.passed,
          failed: result.failed,
          duration: result.duration,
          cases: result.cases.map((c) => ({
            name: c.name,
            passed: c.passed,
            duration: c.duration,
            assertions: c.assertions.map((a) => ({
              name: a.name,
              passed: a.passed,
              message: a.message,
            })),
            error: c.error,
          })),
        },
        null,
        2,
      );
      process.stdout.write(output + '\n');
    },
  };
}
