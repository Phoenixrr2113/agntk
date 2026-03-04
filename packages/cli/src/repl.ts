/**
 * @fileoverview Interactive REPL mode — readline-based agent conversation.
 */

import { createInterface, type Interface } from 'node:readline';
import { createColors } from './ui';
import { setupLockCleanup } from './agents';
import { consumeStream } from './stream';
import { getVersion } from './version';
import type { CLIArgs } from './args';

export async function runRepl(args: CLIArgs): Promise<void> {
  const { createAgent } = await import('@agntk/core');
  const colors = createColors(process.stdout.isTTY ?? false);

  let testModel: import('ai').LanguageModel | undefined;
  if (process.env.AGNTK_TEST_MODE === '1') {
    const { createTestModel } = await import('./test-model.js');
    testModel = createTestModel();
  }

  const agent = createAgent({
    name: args.name!,
    instructions: args.instructions ?? undefined,
    workspaceRoot: args.workspace,
    ...(args.maxSteps > 0 ? { maxSteps: args.maxSteps } : {}),
    ...(testModel ? { model: testModel } : {}),
  });

  setupLockCleanup(args.name!);

  const version = getVersion();
  const output = process.stdout;
  const toolCount = agent.getToolNames().length;

  const modelLabel = agent.getModelId();
  output.write(`\n${colors.bold('⚡ agntk')} ${colors.dim(`(${version})`)}\n`);
  output.write(
    `${colors.cyan(colors.bold(args.name!))} ${colors.dim('|')} ${colors.dim(modelLabel)} ${colors.dim('|')} ${colors.dim(`${toolCount} tools`)} ${colors.dim('|')} ${colors.green('memory: on')}\n`,
  );
  output.write(`${colors.dim('Type /help for commands, /exit or Ctrl+C to quit.')}\n\n`);

  const rl: Interface = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${colors.cyan(colors.bold(args.name! + ' ❯'))} `,
    terminal: true,
  });

  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  const pendingLines: string[] = [];
  let busy = false;
  let closed = false;

  async function processLine(trimmed: string): Promise<void> {
    if (trimmed === '/exit' || trimmed === '/quit') {
      rl.close();
      return;
    }
    if (trimmed === '/help') {
      output.write(
        `\n  ${colors.bold('/help')}    Show commands\n  ${colors.bold('/tools')}   List available tools\n  ${colors.bold('/verbose')} Toggle verbose output\n  ${colors.bold('/exit')}    Quit\n\n`,
      );
      rl.prompt();
      return;
    }
    if (trimmed === '/tools') {
      const tools = agent.getToolNames();
      output.write(`\n${colors.bold(`Tools (${tools.length})`)}:\n  ${tools.join(', ')}\n\n`);
      rl.prompt();
      return;
    }
    if (trimmed === '/verbose') {
      if (args.outputLevel === 'verbose') {
        args.outputLevel = 'normal';
        output.write(`${colors.dim('Verbose output: off')}\n`);
      } else {
        args.outputLevel = 'verbose';
        output.write(`${colors.dim('Verbose output: on')}\n`);
      }
      rl.prompt();
      return;
    }

    busy = true;
    rl.pause();

    history.push({ role: 'user', content: trimmed });

    const maxHistoryPairs = 10;
    const recentHistory =
      history.length > maxHistoryPairs * 2 ? history.slice(-maxHistoryPairs * 2) : history;

    const historyLines = recentHistory.map((h) =>
      h.role === 'user' ? `[User]: ${h.content}` : `[Assistant]: ${h.content}`,
    );
    const contextPrompt = [
      '<conversation_history>',
      ...historyLines.slice(0, -1),
      '</conversation_history>',
      '',
      recentHistory[recentHistory.length - 1]!.content,
    ].join('\n');

    try {
      output.write('\n');
      const result = await agent.stream({ prompt: contextPrompt });
      await consumeStream(result.fullStream, {
        output,
        status: process.stderr,
        level: args.outputLevel,
        colors,
        ...(args.maxSteps > 0 ? { maxSteps: args.maxSteps } : {}),
        isTTY: process.stderr.isTTY ?? false,
      });

      const responseText = (await result.text) ?? '';
      if (responseText && !responseText.endsWith('\n')) {
        output.write('\n');
      }

      history.push({ role: 'assistant', content: responseText });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      output.write(`\n${colors.red('Error:')} ${msg}\n`);
    }

    output.write('\n');
    busy = false;
    rl.resume();

    while (pendingLines.length > 0) {
      const next = pendingLines.shift()!;
      if (next) {
        await processLine(next);
      }
    }

    if (!closed) {
      rl.prompt();
    }
  }

  return new Promise<void>((resolvePromise) => {
    rl.prompt();

    rl.on('line', (line: string) => {
      const trimmed = line.trim();

      if (!trimmed) {
        rl.prompt();
        return;
      }

      if (busy) {
        pendingLines.push(trimmed);
        return;
      }

      processLine(trimmed).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        output.write(`\n${colors.red('Error:')} ${msg}\n`);
        rl.prompt();
      });
    });

    rl.on('close', () => {
      closed = true;

      const finish = () => {
        output.write(`\n${colors.dim('👋 Goodbye!')}\n`);
        resolvePromise();
      };

      if (busy) {
        const interval = setInterval(() => {
          if (!busy) {
            clearInterval(interval);
            finish();
          }
        }, 100);
      } else {
        finish();
      }
    });

    rl.on('SIGINT', () => {
      output.write('\n');
      rl.close();
    });
  });
}
