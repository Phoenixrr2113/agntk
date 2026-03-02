/**
 * @fileoverview One-shot execution mode — run a single prompt and exit.
 */

import { createColors } from './ui';
import { setupLockCleanup } from './agents';
import { consumeStream } from './stream';
import type { CLIArgs } from './args';

export async function runOneShot(prompt: string, args: CLIArgs): Promise<void> {
  const { createAgent } = await import('@agntk/core');
  const colors = createColors(process.stderr.isTTY ?? false);

  const agent = createAgent({
    name: args.name!,
    instructions: args.instructions ?? undefined,
    workspaceRoot: args.workspace,
    maxSteps: args.maxSteps,
  });

  setupLockCleanup(args.name!);

  if (args.outputLevel !== 'quiet') {
    const toolCount = agent.getToolNames().length;
    process.stderr.write(
      `${colors.bold('agntk')} ${colors.dim('|')} ${colors.cyan(args.name!)} ${colors.dim('|')} ${colors.dim(`${toolCount} tools`)} ${colors.dim('|')} ${colors.dim(`workspace: ${args.workspace}`)}\n`,
    );
  }

  // Suppress AI SDK's verbose error dumps to stderr during streaming.
  // We handle errors ourselves via the stream's error events.
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
      maxSteps: args.maxSteps,
      isTTY: process.stderr.isTTY ?? false,
    });

    // If the stream had an error, provide a helpful message and exit
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // "No output generated" is a secondary error after the real error
    // was already displayed by consumeStream. Exit cleanly.
    if (msg.includes('No output generated')) {
      process.exit(1);
    }

    // Detect connection errors
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

    // Re-throw for generic handling
    throw err;
  } finally {
    process.stderr.write = origStderrWrite;
  }
}
