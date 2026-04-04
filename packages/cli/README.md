# @agntk/cli

[![npm version](https://img.shields.io/npm/v/@agntk/cli.svg)](https://www.npmjs.com/package/@agntk/cli)
[![license](https://img.shields.io/npm/l/@agntk/cli.svg)](https://github.com/agntk/agntk/blob/main/LICENSE)

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
| `--max-steps <n>`       |       | Max tool-loop steps (default: 25)           |
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
| `agntk completions`   | Output shell completion script (bash/zsh/fish) |

### Interactive REPL

In REPL mode (`-i` or follow-up after one-shot), type `/` and press TAB for command autocomplete:

| Command    | Description                |
| ---------- | -------------------------- |
| `/help`    | Show available commands    |
| `/tools`   | List available tools       |
| `/agents`  | List all agents            |
| `/model`   | Show current model info    |
| `/memory`  | Show agent memory files    |
| `/status`  | Show session stats         |
| `/verbose` | Toggle verbose output      |
| `/clear`   | Clear conversation history |
| `/exit`    | Quit the REPL              |

### Shell Completion

When installed globally, shell completions auto-install on first run:

```bash
npm i -g @agntk/cli
agntk --version  # triggers auto-install for your shell

# Or generate manually:
agntk completions bash  # bash
agntk completions zsh   # zsh
agntk completions fish  # fish
```

### Update Notifications

agntk checks npm for newer versions in the background (cached for 24 hours). When an update is available, you'll see:

```
Update available: 1.2.8 -> 1.3.0 -- run npm i -g agntk
```

## Provider Detection

The CLI auto-detects your AI provider:

1. **Free tier** — works out of the box via Cerebras (usage limits apply)
2. **OpenRouter** — `export OPENROUTER_API_KEY=sk-or-...`
3. **Ollama** — auto-detected at `localhost:11434`

## Built on @agntk/core

The CLI uses [`@agntk/core`](https://www.npmjs.com/package/@agntk/core) for agent creation, tool management, and model resolution. See the core package for programmatic usage and the full SDK API.

## License

MIT
