/**
 * @fileoverview Interactive REPL for agntk CLI.
 */
import { createInterface, type Interface } from 'node:readline';
import { createColors } from './ui';
import { setupLockCleanup } from './agents';
import { consumeStream, createSubAgentRenderer } from './stream';
import { getVersion } from './version';
import { createCompleter, getCommand, type CommandContext } from './commands';
import type { CLIArgs } from './args';
import type { Agent } from '@agntk/core';

export interface ReplOptions {
  agent?: Agent;
  initialHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export async function runRepl(args: CLIArgs, opts?: ReplOptions): Promise<void> {
  const colors = createColors(process.stdout.isTTY ?? false);
  let agent: Agent;

  if (opts?.agent) {
    agent = opts.agent;
  } else {
    const { createAgent } = await import('@agntk/core');

    let testModel: import('ai').LanguageModel | undefined;
    if (process.env.AGNTK_TEST_MODE === '1') {
      const { createTestModel } = await import('./test-model.js');
      testModel = createTestModel();
    }

    const subAgentRenderer = createSubAgentRenderer({
      status: process.stderr,
      colors,
      level: args.outputLevel,
      isTTY: process.stderr.isTTY ?? false,
    });

    agent = createAgent({
      name: args.name!,
      instructions: args.instructions ?? undefined,
      workspaceRoot: args.workspace,
      ...(args.maxSteps > 0 ? { maxSteps: args.maxSteps } : {}),
      ...(testModel ? { model: testModel } : {}),
      onSubAgentActivity: subAgentRenderer,
    });
  }

  if (!opts?.agent) {
    setupLockCleanup(args.name!);
  }
  const output = process.stdout;

  if (opts?.initialHistory) {
    output.write(
      `${colors.dim('Type a follow-up, /help for commands, /exit or Ctrl+C to quit.')}\n\n`,
    );
  } else {
    const version = getVersion();
    const toolCount = agent.getToolNames().length;
    const modelLabel = agent.getModelId();
    output.write(`\n${colors.bold('⚡ agntk')} ${colors.dim(`(${version})`)}\n`);
    output.write(
      `${colors.cyan(colors.bold(args.name!))} ${colors.dim('|')} ${colors.dim(modelLabel)} ${colors.dim('|')} ${colors.dim(`${toolCount} tools`)} ${colors.dim('|')} ${colors.green('memory: on')}\n`,
    );
    output.write(`${colors.dim('Type /help for commands, /exit or Ctrl+C to quit.')}\n\n`);
  }

  const completer = createCompleter();
  const rl: Interface = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${colors.cyan(colors.bold(args.name! + ' ❯'))} `,
    terminal: true,
    completer,
  });

  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [
    ...(opts?.initialHistory ?? []),
  ];

  const pendingLines: string[] = [];
  let busy = false;
  let closed = false;

  async function processLine(trimmed: string): Promise<void> {
    if (trimmed.startsWith('/')) {
      const spaceIdx = trimmed.indexOf(' ');
      const cmdName = spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx);
      const cmd = getCommand(cmdName);

      if (cmd) {
        const ctx: CommandContext = { agent, args, colors, output, history, rl };
        await cmd.execute(ctx);
        if (cmdName !== 'exit' && cmdName !== 'quit') {
          rl.prompt();
        }
        return;
      }

      output.write(
        `${colors.dim(`Unknown command: ${trimmed}. Type /help for available commands.`)}\n`,
      );
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
