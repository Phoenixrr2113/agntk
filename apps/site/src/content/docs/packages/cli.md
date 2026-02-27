---
title: "CLI Reference"
description: "CLI flags, modes, piped input, REPL, agent management"
---

```
agntk "prompt"                    Run a one-shot task
agntk -n <name> "prompt"          Named agent (persistent memory)
agntk -n <name> -i                Interactive REPL
agntk list                        List all agents
```

| Flag | Short | Description |
|------|-------|-------------|
| `--name` | `-n` | Agent name (enables persistent memory) |
| `--instructions` | | Custom system prompt |
| `--interactive` | `-i` | Interactive REPL mode |
| `--workspace` | | Workspace root (default: current directory) |
| `--max-steps` | | Max tool-loop steps (default: 25) |
| `--verbose` | | Show full tool args and output |
| `--quiet` | `-q` | Text output only (for piping) |
| `--version` | `-v` | Show version |
| `--help` | `-h` | Show help |

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
```

---
