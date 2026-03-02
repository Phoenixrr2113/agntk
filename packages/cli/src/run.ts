/**
 * @fileoverview Main orchestrator — parses args, resolves provider, routes to command.
 * This is the only place that calls process.exit() for normal flow control.
 */

import { homedir } from 'node:os';
import { parseCLIArgs, printHelp } from './args';
import { listAgents } from './agents';
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
  '       agntk list\n' +
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

  if (args.list) {
    listAgents();
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

  // Resolve provider (async cascade: BYOK → Ollama → Free Tier)
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
