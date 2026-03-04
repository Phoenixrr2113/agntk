# @agntk/cli

CLI for [agntk](https://www.npmjs.com/package/agntk) — a portable AI agent you install and point at problems.

> **Most users should install [`agntk`](https://www.npmjs.com/package/agntk) instead**, which re-exports this package and works with `npx agntk`.

## Installation

```bash
npm install -g @agntk/cli
# or
pnpm add -g @agntk/cli
```

## Quick Start

```bash
# One-shot prompt
agntk "fix the failing tests"

# Named agent with persistent memory
agntk -n coder "refactor the auth module"

# Interactive REPL
agntk -n coder -i

# Pipe input
cat error.log | agntk "explain this error"
```

After a one-shot prompt completes, you can type follow-up messages without re-running the command. The agent remembers the conversation. Use `-q`/`--quiet` to disable this and exit immediately.

## CLI Reference

### Options

| Flag                    | Short | Description                                 |
| ----------------------- | ----- | ------------------------------------------- |
| `--name <name>`         | `-n`  | Agent name (enables persistent memory)      |
| `--instructions <text>` |       | Custom system prompt                        |
| `--interactive`         | `-i`  | Interactive REPL mode                       |
| `--workspace <path>`    |       | Workspace root (default: cwd)               |
| `--max-steps <n>`       |       | Max tool-loop steps (default: unlimited)    |
| `--verbose`             |       | Show full tool args and output              |
| `--quiet`               | `-q`  | Text output only, no follow-up (for piping) |
| `--version`             | `-v`  | Show version                                |
| `--help`                | `-h`  | Show help                                   |

### Agent Management Commands

| Command               | Description                                    |
| --------------------- | ---------------------------------------------- |
| `agntk list`          | List all known agents                          |
| `agntk info <name>`   | Show agent details (memory, workspace, tokens) |
| `agntk delete <name>` | Delete an agent's state                        |
| `agntk stop <name>`   | Stop a running agent                           |
| `agntk clean`         | Interactively remove stale agents              |

## Provider Detection

The CLI auto-detects your AI provider:

1. **Free tier** — works out of the box via Cerebras (usage limits apply)
2. **OpenRouter** — `export OPENROUTER_API_KEY=sk-or-...`
3. **Ollama** — auto-detected at `localhost:11434`

## Built on @agntk/core

The CLI uses [`@agntk/core`](https://www.npmjs.com/package/@agntk/core) for agent creation, tool management, and model resolution. See the core package for programmatic usage and the full SDK API.

## License

MIT
