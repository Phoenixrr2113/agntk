import { homedir } from 'node:os';
import { parseCLIArgs, printHelp } from './args';
import { listAgents, agentInfo, deleteAgent, stopAgent, cleanAgents } from './agents';
import { runOneShot } from './oneshot';
import { runRepl } from './repl';
import { readStdin } from './stream';
import { createColors } from './ui';
import { getVersion } from './version';
import { loadDotenvFallback } from './config';
import { ensureCompletions } from './setup-completions';
import { checkForUpdate } from './update-check';

const USAGE_HINT =
  'Usage: agntk "your prompt"\n' +
  '       agntk -n <name> "your prompt"\n' +
  '       agntk -n <name> -i\n' +
  '       agntk list | info | delete | stop | clean\n' +
  '       agntk -h';

export async function main(): Promise<void> {
  ensureCompletions();
  const args = parseCLIArgs(process.argv.slice(2));

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
      case 'completions': {
        const shell = args.commandArg;
        if (!shell || !['bash', 'zsh', 'fish'].includes(shell)) {
          console.error('Usage: agntk completions bash|zsh|fish');
          console.error('');
          console.error('  Add to your shell config:');
          console.error('    Bash:  eval "$(agntk completions bash)"');
          console.error('    Zsh:   eval "$(agntk completions zsh)"');
          console.error('    Fish:  agntk completions fish | source');
          process.exit(1);
        }
        const { generateCompletionScript } = await import('./completions.js');
        process.stdout.write(generateCompletionScript(shell as 'bash' | 'zsh' | 'fish'));
        break;
      }
    }
    process.exit(0);
  }

  if (!args.name) {
    if (!args.prompt && process.stdin.isTTY) {
      console.error(`Error: No prompt provided.\n${USAGE_HINT}`);
      process.exit(1);
    }

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

      const updateMsg = checkForUpdate();
      if (updateMsg) {
        process.stderr.write(`  ${colors.yellow(updateMsg)}\n`);
      }
    }
  }

  if (args.workspace === homedir()) {
    process.stderr.write(
      'Warning: Workspace is your home directory.\n' +
        '  Run from a project directory, or use --workspace <path>\n\n',
    );
  }

  if (args.interactive) {
    await runRepl(args);
    process.exit(0);
  }

  let prompt = args.prompt;
  const pipedInput = await readStdin();
  if (pipedInput) {
    prompt = prompt ? `${pipedInput}\n\n${prompt}` : pipedInput;
  }

  if (!prompt) {
    console.error(`Error: No prompt provided.\n${USAGE_HINT}`);
    process.exit(1);
  }

  const result = await runOneShot(prompt, args);

  const canFollowUp =
    result && process.stdin.isTTY && process.stderr.isTTY && args.outputLevel !== 'quiet';

  if (canFollowUp) {
    await runRepl(args, {
      agent: result.agent,
      initialHistory: [
        { role: 'user', content: prompt },
        { role: 'assistant', content: result.responseText },
      ],
    });
  }

  try {
    const { shutdownObservability } = await import('@agntk/core');
    await shutdownObservability();
  } catch {
    void 0;
  }

  process.exit(0);
}
