import { createLogger } from '@agntk/logger';
import { generateObject } from 'ai';
import { z } from 'zod';
import type { LanguageModel, LanguageModelUsage } from 'ai';
import type { Agent } from '../types/agent';
import { resolveModel } from '../models';

const log = createLogger('@agntk/core:refine-loop');

export interface RefineLoopConfig {
  judgeModel?: LanguageModel;

  criteria: string;

  threshold?: number;

  maxIterations?: number;

  evaluator?: (output: string) => Promise<EvaluationResult>;
}

export interface EvaluationResult {
  score: number;

  critique: string;

  strengths?: string[];

  weaknesses?: string[];
}

export interface RefineLoopAttempt {
  text: string;

  score: number;

  critique: string;

  strengths?: string[];

  weaknesses?: string[];
}

export interface RefineLoopResult {
  text: string;

  score: number;

  iterations: number;

  history: RefineLoopAttempt[];

  usage: { inputTokens: number; outputTokens: number; totalTokens: number };

  thresholdMet: boolean;
}

const evaluationSchema = z.object({
  score: z.number().min(0).max(1).describe('Quality score between 0 and 1'),
  critique: z.string().describe('Specific critique for improvement'),
  strengths: z.array(z.string()).describe('What the output does well'),
  weaknesses: z.array(z.string()).describe('What needs improvement'),
});

export async function withRefineLoop(
  agent: Agent,
  prompt: string,
  config: RefineLoopConfig,
): Promise<RefineLoopResult> {
  const { criteria, threshold = 0.7, maxIterations = 3, evaluator } = config;

  const judgeModel = config.judgeModel ?? resolveModel({ tier: 'fast' }).model;

  log.info('Starting refine loop', {
    criteria: criteria.slice(0, 50),
    threshold,
    maxIterations,
  });

  const history: RefineLoopAttempt[] = [];
  const totalUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let currentPrompt = prompt;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    log.debug('Refine iteration', { iteration, maxIterations });

    const agentOutput = await runAgent(agent, currentPrompt, totalUsage);

    const evaluation = evaluator
      ? await evaluator(agentOutput)
      : await evaluateWithLLM(agentOutput, prompt, criteria, judgeModel, totalUsage);

    const attempt: RefineLoopAttempt = {
      text: agentOutput,
      score: evaluation.score,
      critique: evaluation.critique,
      strengths: evaluation.strengths,
      weaknesses: evaluation.weaknesses,
    };
    history.push(attempt);

    log.info('Iteration evaluated', {
      iteration,
      score: evaluation.score,
      threshold,
      passed: evaluation.score >= threshold,
    });

    if (evaluation.score >= threshold) {
      log.info('Threshold met', { iteration, score: evaluation.score });
      return {
        text: agentOutput,
        score: evaluation.score,
        iterations: iteration,
        history,
        usage: totalUsage,
        thresholdMet: true,
      };
    }

    if (iteration < maxIterations) {
      currentPrompt = buildCritiquePrompt(
        prompt,
        evaluation.score,
        evaluation.critique,
        evaluation.weaknesses ?? [],
      );
    }
  }

  const bestAttempt = history.reduce((best, current) =>
    current.score > best.score ? current : best,
  );

  log.info('Max iterations reached, returning best attempt', {
    iterations: maxIterations,
    bestScore: bestAttempt.score,
  });

  return {
    text: bestAttempt.text,
    score: bestAttempt.score,
    iterations: maxIterations,
    history,
    usage: totalUsage,
    thresholdMet: false,
  };
}

async function runAgent(
  agent: Agent,
  prompt: string,
  totalUsage: { inputTokens: number; outputTokens: number; totalTokens: number },
): Promise<string> {
  const result = await agent.stream({ prompt });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const _chunk of result.fullStream) {
    void 0;
  }

  const text = await result.text;
  const usage = (await result.usage) as LanguageModelUsage | undefined;

  if (usage) {
    totalUsage.inputTokens += usage.inputTokens ?? 0;
    totalUsage.outputTokens += usage.outputTokens ?? 0;
    totalUsage.totalTokens += (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  }

  return text ?? '';
}

async function evaluateWithLLM(
  output: string,
  originalPrompt: string,
  criteria: string,
  model: LanguageModel,
  totalUsage: { inputTokens: number; outputTokens: number; totalTokens: number },
): Promise<EvaluationResult> {
  try {
    const result = await generateObject({
      model,
      schema: evaluationSchema,
      prompt: `Evaluate this output against the criteria.

Criteria: ${criteria}

Original request: ${originalPrompt.slice(0, 500)}

Output to evaluate:
${output.slice(0, 3000)}

Score 0-1 (where 1 is perfect) and provide specific critique for improvement.`,
    });

    if (result.usage) {
      totalUsage.inputTokens += result.usage.inputTokens ?? 0;
      totalUsage.outputTokens += result.usage.outputTokens ?? 0;
      totalUsage.totalTokens += (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0);
    }

    return {
      score: result.object.score,
      critique: result.object.critique,
      strengths: result.object.strengths,
      weaknesses: result.object.weaknesses,
    };
  } catch (error) {
    log.error('LLM evaluation failed', { error: String(error) });

    return {
      score: 0.3,
      critique: 'Evaluation failed. Please improve the output.',
      strengths: [],
      weaknesses: ['Could not evaluate — re-attempt recommended'],
    };
  }
}

function buildCritiquePrompt(
  originalPrompt: string,
  score: number,
  critique: string,
  weaknesses: string[],
): string {
  const weaknessText = weaknesses.length > 0 ? `Weaknesses: ${weaknesses.join('; ')}` : '';

  return `[Previous attempt scored ${score.toFixed(2)}/1.0]
Critique: ${critique}
${weaknessText}

Please improve your response addressing the above feedback.

Original request: ${originalPrompt}`;
}
