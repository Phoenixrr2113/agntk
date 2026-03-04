/**
 * @fileoverview Main orchestrator — parses args, resolves provider, routes to command.
 * This is the only place that calls process.exit() for normal flow control.
 */

import { homedir } from 'node:os';
import { parseCLIArgs, printHelp } from './args';
import { listAgents, agentInfo, deleteAgent, stopAgent, cleanAgents } from './agents';
import { runOneShot } from './oneshot';
import { runRepl } from './repl';
import { readStdin } from './stream';
import { createColors } from './ui';
import { getVersion } from './version';
import { loadDotenvFallback } from './config';

const USAGE_HINT =
  'Usage: agntk "your prompt"\n' +
  '       agntk -n <name> "your prompt"\n' +
  '       agntk -n <name> -i\n' +
  '       agntk list | info | delete | stop | clean\n' +
  '       agntk -h';

export async function main(): Promise<void> {
  const args = parseCLIArgs(process.argv.slice(2));

  // Fast paths — no heavy imports
  if (args.version) {
    console.log(`agntk (${getVersion()})`);
    process.exit(0);
  }

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.command) {
    switch (args.command) {
      case 'list':
        listAgents();
        break;
      case 'info':
        if (!args.commandArg) {
          console.error('Usage: agntk info <name>');
          process.exit(1);
        }
        agentInfo(args.commandArg);
        break;
      case 'delete':
        if (!args.commandArg) {
          console.error('Usage: agntk delete <name>');
          process.exit(1);
        }
        await deleteAgent(args.commandArg);
        break;
      case 'stop':
        if (!args.commandArg) {
          console.error('Usage: agntk stop <name>');
          process.exit(1);
        }
        stopAgent(args.commandArg);
        break;
      case 'clean':
        await cleanAgents();
        break;
    }
    process.exit(0);
  }

  // Validate: need a name or prompt
  if (!args.name) {
    if (!args.prompt && process.stdin.isTTY) {
      console.error(`Error: No prompt provided.\n${USAGE_HINT}`);
      process.exit(1);
    }

    // Default name if no --name flag was given
    args.name = 'default';
  }

  if (process.env.AGNTK_TEST_MODE === '1') {
    const { setResolvedProvider } = await import('@agntk/core');
    setResolvedProvider({ provider: 'test', source: 'test mode', isFree: false });
  } else {
    loadDotenvFallback();
    const { resolveProvider, setResolvedProvider } = await import('@agntk/core');
    const resolvedProvider = await resolveProvider();
    setResolvedProvider(resolvedProvider);

    if (args.outputLevel !== 'quiet') {
      const colors = createColors(process.stderr.isTTY ?? false);
      const providerLabel = resolvedProvider.isFree
        ? `${resolvedProvider.source} — usage limits apply`
        : resolvedProvider.source;
      process.stderr.write(`  provider: ${providerLabel}\n`);

      if (resolvedProvider.ollamaModels) {
        process.stderr.write(`  models:   ${resolvedProvider.ollamaModels.reason}\n`);
      }

      if (resolvedProvider.ollamaSkipReason) {
        process.stderr.write(`  ${colors.yellow('note:')} ${resolvedProvider.ollamaSkipReason}\n`);
      }
    }
  }

  // Warn if workspace is the home directory (likely unintentional)
  if (args.workspace === homedir()) {
    process.stderr.write(
      'Warning: Workspace is your home directory.\n' +
        '  Run from a project directory, or use --workspace <path>\n\n',
    );
  }

  // Interactive mode
  if (args.interactive) {
    await runRepl(args);
    process.exit(0);
  }

  // Build final prompt (handle piped stdin)
  let prompt = args.prompt;
  const pipedInput = await readStdin();
  if (pipedInput) {
    prompt = prompt ? `${pipedInput}\n\n${prompt}` : pipedInput;
  }

  if (!prompt) {
    console.error(`Error: No prompt provided.\n${USAGE_HINT}`);
    process.exit(1);
  }

  // One-shot mode
  await runOneShot(prompt, args);

  // Flush observability traces before exit
  try {
    const { shutdownObservability } = await import('@agntk/core');
    await shutdownObservability();
  } catch {
    // Observability not available — that's fine
  }

  process.exit(0);
}
