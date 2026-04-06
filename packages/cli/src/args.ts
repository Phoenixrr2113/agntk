import { getVersion } from './version';

export type OutputLevel = 'quiet' | 'normal' | 'verbose';

export type CLICommand = 'list' | 'info' | 'delete' | 'stop' | 'clean' | 'completions' | 'install' | 'uninstall' | 'evaluate';

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
  command: CLICommand | null;
  commandArg: string | null;
}

export const CLI_COMMANDS = ['list', 'info', 'delete', 'stop', 'clean', 'completions', 'install', 'uninstall', 'evaluate'] as const;

export const CLI_FLAGS = [
  '-n',
  '--name',
  '--instructions',
  '-i',
  '--interactive',
  '--workspace',
  '--verbose',
  '-q',
  '--quiet',
  '--max-steps',
  '-h',
  '--help',
  '-v',
  '--version',
] as const;

export const COMMANDS_WITH_AGENT_ARG = ['info', 'delete', 'stop'] as const;

const COMMANDS = new Set<CLICommand>(CLI_COMMANDS);

/**
 *
 * @param argv
 */
export function parseCLIArgs(argv: string[]): CLIArgs {
  const args: CLIArgs = {
    name: null,
    instructions: null,
    prompt: null,
    interactive: false,
    workspace: process.cwd(),
    outputLevel: 'normal',
    maxSteps: 0,
    help: false,
    version: false,
    command: null,
    commandArg: null,
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
        {
          const val = parseInt(argv[++i] ?? '0', 10);
          args.maxSteps = Number.isNaN(val) || val <= 0 ? 0 : val;
        }
        break;
      case '-h':
      case '--help':
        args.help = true;
        break;
      case '-v':
      case '--version':
        args.version = true;
        break;
      default:
        if (!arg.startsWith('-')) {
          if (positionals.length === 0 && COMMANDS.has(arg as CLICommand)) {
            args.command = arg as CLICommand;
            const next = argv[i + 1];
            if (next && !next.startsWith('-') && !COMMANDS.has(next as CLICommand)) {
              args.commandArg = next;
              i++;
            }
          } else {
            positionals.push(arg);
          }
        }
        break;
    }
  }

  if (positionals.length > 0) {
    args.prompt = positionals.join(' ');
  }

  return args;
}

/**
 *
 */
export function printHelp(): void {
  const version = getVersion();
  console.log(`
  agntk (${version}) — zero-config AI agent

  Usage:
    agntk "prompt"                        One-shot prompt (exits when done)
    agntk -n <name> "prompt"             Named agent with persistent memory
    agntk -n <name> -i                   Interactive REPL with named agent
    agntk <command> [arg]                Manage agents

  Options:
    -n, --name <name>        Agent name — enables persistent memory across runs
    --instructions <text>    System prompt override for what this agent does
    -i, --interactive        Start interactive REPL (read-eval-print loop)
    --workspace <path>       Working directory for file tools (default: cwd)
    --max-steps <n>          Limit tool-loop iterations (default: unlimited)
    --verbose                Print full tool arguments and raw output
    -q, --quiet              Suppress all decorations — plain text only, no REPL
    -v, --version            Print version and exit
    -h, --help               Print this help and exit

  After a one-shot prompt completes, agntk enters follow-up mode so you can
  continue the conversation without re-running the command. The agent retains
  the full message history. Use -q/--quiet to suppress this and exit immediately.

  Commands:
    list                     List all known agents and their status
    info <name>              Show agent details: memory, workspace, token usage
    delete <name>            Permanently delete an agent and its memory
    stop <name>              Send SIGTERM to a running agent process
    clean                    Interactively prune stale or unused agents
    completions <shell>      Output shell completion script (bash, zsh, fish)
    install <file.md>        Install a capability file into the agent's harness
    uninstall <path>         Remove an installed capability
    evaluate <file.md>       Validate a capability file without installing

  Examples:
    agntk "fix the failing tests"
    agntk "what does this codebase do" --verbose
    agntk -n coder "fix the failing tests"
    agntk -n ops --instructions "you manage k8s deploys" "roll back staging"
    agntk -n coder --max-steps 20 "refactor auth module"
    agntk -n coder -i
    agntk list
    agntk info coder
    agntk delete old-agent
    agntk clean
    cat error.log | agntk -n debugger "explain this error"

  Environment Variables:
    OPENROUTER_API_KEY       Use OpenRouter (access to 300+ models)
    OPENAI_API_KEY           Use OpenAI directly (GPT-4o, o1, etc.)
    CEREBRAS_API_KEY         Use Cerebras (fast inference)
    OLLAMA_ENABLED=true      Force Ollama even if a cloud key is set
    OLLAMA_BASE_URL          Ollama server URL (default: http://localhost:11434)
    OLLAMA_FAST_MODEL        Override the fast-tier Ollama model name
    OLLAMA_FULL_MODEL        Override the full-tier Ollama model name
    DEBUG                    Enable verbose debug logging (any non-empty value)

  Provider (auto-detected, in priority order):
    1. OPENROUTER_API_KEY / OPENAI_API_KEY / CEREBRAS_API_KEY — your own key
    2. Ollama running locally — auto-detected at localhost:11434
    3. Built-in free tier (Cerebras) — rate-limited, no key required
`);
}
