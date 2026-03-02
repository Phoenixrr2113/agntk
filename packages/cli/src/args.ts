/**
 * @fileoverview CLI argument parsing and help text.
 * Intentionally minimal — no dependencies on arg-parsing libraries.
 */

import { getVersion } from './version';

// ============================================================================
// Types
// ============================================================================

export type OutputLevel = 'quiet' | 'normal' | 'verbose';

export interface CLIArgs {
  name: string | null;
  instructions: string | null;
  prompt: string | null;
  interactive: boolean;
  workspace: string;
  outputLevel: OutputLevel;
  maxSteps: number;
  help: boolean;
  version: boolean;
  list: boolean;
}

// ============================================================================
// Arg Parsing
// ============================================================================

export function parseCLIArgs(argv: string[]): CLIArgs {
  const args: CLIArgs = {
    name: null,
    instructions: null,
    prompt: null,
    interactive: false,
    workspace: process.cwd(),
    outputLevel: 'normal',
    maxSteps: 25,
    help: false,
    version: false,
    list: false,
  };

  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;

    switch (arg) {
      case '--name':
      case '-n':
        args.name = argv[++i] ?? null;
        break;
      case '--instructions':
        args.instructions = argv[++i] ?? null;
        break;
      case '-i':
      case '--interactive':
        args.interactive = true;
        break;
      case '--workspace':
        args.workspace = argv[++i] ?? process.cwd();
        break;
      case '--verbose':
        args.outputLevel = 'verbose';
        break;
      case '-q':
      case '--quiet':
        args.outputLevel = 'quiet';
        break;
      case '--max-steps':
        args.maxSteps = parseInt(argv[++i] ?? '25', 10);
        break;
      case '-h':
      case '--help':
        args.help = true;
        break;
      case '-v':
      case '--version':
        args.version = true;
        break;
      case 'list':
        if (positionals.length === 0) {
          args.list = true;
        } else {
          positionals.push(arg);
        }
        break;
      default:
        if (!arg.startsWith('-')) {
          positionals.push(arg);
        }
        break;
    }
  }

  // All positionals join into the prompt.
  //   agntk "do something"              → prompt = "do something"
  //   agntk whats up                    → prompt = "whats up"
  //   agntk -n myagent fix the tests    → name = "myagent", prompt = "fix the tests"
  if (positionals.length > 0) {
    args.prompt = positionals.join(' ');
  }

  return args;
}

// ============================================================================
// Help
// ============================================================================

export function printHelp(): void {
  const version = getVersion();
  console.log(`
  agntk (${version}) — zero-config AI agent

  Usage:
    agntk "prompt"
    agntk -n <name> "prompt"
    agntk -n <name> -i
    agntk list

  Options:
    -n, --name <name>        Agent name (enables persistent memory)
    --instructions <text>    What the agent does (injected as system prompt)
    -i, --interactive        Interactive REPL mode
    --workspace <path>       Workspace root (default: cwd)
    --max-steps <n>          Max tool-loop steps (default: 25)
    --verbose                Show full tool args and output
    -q, --quiet              Text output only (for piping)
    -v, --version            Show version
    -h, --help               Show help

  Commands:
    list                     List all known agents

  Examples:
    agntk "fix the failing tests"
    agntk whats up
    agntk -n coder "fix the failing tests"
    agntk -n ops --instructions "you manage k8s deploys" "roll back staging"
    agntk -n coder -i
    agntk list
    cat error.log | agntk -n debugger "explain"

  Provider (auto-detected):
    Works out of the box with the free tier (Cerebras).
    For your own key:  export OPENROUTER_API_KEY=sk-or-...
    For local models:  install Ollama (auto-detected at localhost:11434)
`);
}
