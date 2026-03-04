---
title: 'CLI Reference'
description: 'CLI flags, modes, piped input, REPL, agent management'
---

```
agntk "prompt"                    Run a one-shot task
agntk -n <name> "prompt"          Named agent (persistent memory)
agntk -n <name> -i                Interactive REPL
agntk list                        List all agents
agntk info <name>                 Show agent details
agntk delete <name>               Delete an agent's state
agntk stop <name>                 Stop a running agent
agntk clean                       Interactively remove stale agents
```

## Options

| Flag             | Short | Description                                 |
| ---------------- | ----- | ------------------------------------------- |
| `--name`         | `-n`  | Agent name (enables persistent memory)      |
| `--instructions` |       | Custom system prompt                        |
| `--interactive`  | `-i`  | Interactive REPL mode                       |
| `--workspace`    |       | Workspace root (default: current directory) |
| `--max-steps`    |       | Max tool-loop steps (default: unlimited)    |
| `--verbose`      |       | Show full tool args and output              |
| `--quiet`        | `-q`  | Text output only (for piping)               |
| `--version`      | `-v`  | Show version                                |
| `--help`         | `-h`  | Show help                                   |

## Agent Management

Manage agent state from the command line without touching the filesystem directly.

### `list`

Shows all agents with their status (running/idle), last active time, and whether they have memory files.

```bash
npx agntk list
```

### `info <name>`

Detailed view of a single agent: memory files, workspace contents, sub-agents with token usage, and total disk size.

```bash
npx agntk info coder
```

### `delete <name>`

Delete an agent's state directory. Prompts for confirmation. Refuses to delete a running agent.

```bash
npx agntk delete old-agent
```

### `stop <name>`

Stop a running agent by sending SIGTERM. If the process doesn't exit within 500ms, sends SIGKILL and cleans up the lock file.

```bash
npx agntk stop coder
```

### `clean`

Interactive bulk cleanup. Shows a numbered list of all agents with status and disk size. Select agents by number, range (`1-5`), comma-separated (`1,3,7`), or `all idle`. Running agents are protected and skipped.

```bash
npx agntk clean
```

## Examples

```bash
# Fix bugs
npx agntk -n coder "the login page crashes when the session expires — find and fix it"

# DevOps
npx agntk -n ops --instructions "you manage k8s deploys" "roll back staging"

# Research
npx agntk "compare React Server Components vs Astro islands — pros, cons, benchmarks"

# Code review
npx agntk "review src/ for security issues and suggest fixes"

# Pipe anything
git diff | npx agntk "write a commit message for this diff"
cat package.json | npx agntk "are any of these dependencies outdated?"

# Agent management
npx agntk info coder
npx agntk delete old-agent
npx agntk clean
```

---
