/**
 * @fileoverview Single-turn execution for agntk CLI.
 */
import { createColors } from './ui';
import { setupLockCleanup } from './agents';
import { consumeStream, createSubAgentRenderer } from './stream';
import type { CLIArgs } from './args';
import type { Agent } from '@agntk/core';

export interface OneShotResult {
  agent: Agent;
  responseText: string;
}

export async function runOneShot(prompt: string, args: CLIArgs): Promise<OneShotResult | null> {
  const { createAgent } = await import('@agntk/core');
  const colors = createColors(process.stderr.isTTY ?? false);

  let testModel: import('ai').LanguageModel | undefined;
  if (process.env.AGNTK_TEST_MODE === '1') {
    const { createTestModel } = await import('./test-model.js');
    testModel = createTestModel();
  }

  const isTTY = process.stderr.isTTY ?? false;
  const subAgentRenderer = createSubAgentRenderer({
    status: process.stderr,
    colors,
    level: args.outputLevel,
    isTTY,
  });

  const agent = createAgent({
    name: args.name!,
    instructions: args.instructions ?? undefined,
    workspaceRoot: args.workspace,
    ...(args.maxSteps > 0 ? { maxSteps: args.maxSteps } : {}),
    ...(testModel ? { model: testModel } : {}),
    onSubAgentActivity: subAgentRenderer,
  });

  setupLockCleanup(args.name!);

  if (args.outputLevel !== 'quiet') {
    const toolCount = agent.getToolNames().length;
    const modelLabel = agent.getModelId();
    process.stderr.write(
      `${colors.bold('agntk')} ${colors.dim('|')} ${colors.cyan(args.name!)} ${colors.dim('|')} ${colors.dim(modelLabel)} ${colors.dim('|')} ${colors.dim(`${toolCount} tools`)} ${colors.dim('|')} ${colors.dim(`workspace: ${args.workspace}`)}\n`,
    );
  }

  const origStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((...writeArgs: Parameters<typeof process.stderr.write>) => {
    const text = typeof writeArgs[0] === 'string' ? writeArgs[0] : (writeArgs[0]?.toString() ?? '');
    if (text.includes('APICallError') || text.includes('AI_APICallError')) {
      return true;
    }
    return origStderrWrite(...writeArgs);
  }) as typeof process.stderr.write;

  try {
    const result = await agent.stream({ prompt });

    const { streamError } = await consumeStream(result.fullStream, {
      output: process.stdout,
      status: process.stderr,
      level: args.outputLevel,
      colors,
      ...(args.maxSteps > 0 ? { maxSteps: args.maxSteps } : {}),
      isTTY: process.stderr.isTTY ?? false,
    });

    if (streamError) {
      const { getResolvedProviderState } = await import('@agntk/core');
      const providerName = getResolvedProviderState()?.provider ?? 'unknown';

      if (streamError.includes('not found') && providerName === 'ollama') {
        const modelMatch = streamError.match(/model '([^']+)'/);
        const model = modelMatch?.[1] ?? 'unknown';
        process.stderr.write(`  Run ${colors.cyan(`ollama pull ${model}`)} to install it.\n`);
      }
      process.exit(1);
    }

    const finalText = await result.text;
    if (finalText && !finalText.endsWith('\n')) {
      process.stdout.write('\n');
    }

    if (args.outputLevel === 'verbose') {
      const usage = await result.usage;
      if (usage) {
        process.stderr.write(
          colors.dim(
            `[usage] ${usage.inputTokens ?? 0} input + ${usage.outputTokens ?? 0} output tokens\n`,
          ),
        );
      }
    }

    return { agent, responseText: finalText ?? '' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    if (msg.includes('No output generated')) {
      process.exit(1);
    }

    if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
      const { getResolvedProviderState } = await import('@agntk/core');
      const providerName = getResolvedProviderState()?.provider ?? 'unknown';
      process.stderr.write(
        `\n${colors.red(colors.bold('✖ Error:'))} Could not connect to ${providerName}.\n`,
      );
      if (providerName === 'ollama') {
        process.stderr.write(`  Is Ollama running? Try ${colors.cyan('ollama serve')}\n`);
      }
      process.exit(1);
    }

    throw err;
  } finally {
    process.stderr.write = origStderrWrite;
  }

  return null;
}
