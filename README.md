# agntk

AI agent you install and point at problems. Zero config. Works immediately.

```bash
npx agntk "fix the failing tests"
```

No API keys required — a free tier is included. Bring your own key or install Ollama for unlimited local use.

---

## Quick Start

```bash
# One-shot: give it a task
npx agntk "organize this folder by file type"

# Named agent: remembers context across sessions
npx agntk -n coder "refactor the auth module to use JWT"

# Interactive REPL
npx agntk -n coder -i

# Pipe input
cat error.log | npx agntk "explain these errors and suggest fixes"

# List your agents
npx agntk list
```

That's it. No config files. No API key setup (unless you want to). It reads your files, runs commands, browses the web, spawns sub-agents, and remembers what it learns.

---

## What It Does

Out of the box, every agent has 20+ built-in tools:

- **Files** — read, write, edit, create, glob, grep across your workspace
- **Code** — AST-aware search and replace via ast-grep
- **Shell** — run commands, manage background processes
- **Browser** — navigate, extract, interact with web pages
- **Planning** — break down complex tasks, deep reasoning for hard problems
- **Memory** — remember facts, recall context, build knowledge across sessions
- **Sub-agents** — spawn specialized agents (coder, researcher, analyst) for parallel work
- **Skills** — auto-discover `SKILL.md` files for project-specific capabilities

---

## Zero-Config Provider Cascade

agntk auto-detects the best available AI provider:

| Priority | Provider | How it's detected |
|----------|----------|-------------------|
| 1 | **Your API key** | `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, or `CEREBRAS_API_KEY` in env |
| 2 | **Ollama** | Auto-detected at `localhost:11434` — picks the right model for your hardware |
| 3 | **Free tier** | Built-in, no setup — backed by Cerebras (rate-limited) |

```bash
# Use your own key for unlimited access (recommended)
export OPENROUTER_API_KEY=sk-or-...

# Or use local models — just install Ollama, agntk finds it automatically
# https://ollama.com

# Or just run it — the free tier works out of the box
npx agntk "hello"
```

---

## CLI Reference

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

### Examples

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

## Named Agents & Memory

Give an agent a name and it remembers context across sessions:

```bash
# First session — agent learns about your project
npx agntk -n myproject "read the codebase and understand the architecture"

# Later session — agent already knows the context
npx agntk -n myproject "add rate limiting to the API endpoints"

# See what agents exist
npx agntk list
```

Memory is stored at `~/.agntk/agents/{name}/` as plain markdown files:

| File | Description |
|------|-------------|
| `memory.md` | Agent-curated facts about your project |
| `context.md` | Session context the agent rewrites as it learns |
| `decisions.md` | Append-only log of decisions made |
| `preferences.md` | Cross-project preferences |
| `identity.md` | Human-authored identity (you can edit this) |
| `project.md` | Human-authored project context |

---

## Hardware-Aware Local Inference

When Ollama is detected, agntk checks your hardware and picks the largest model your system can run comfortably:

| Your RAM | Model Selected | Why |
|----------|---------------|-----|
| 8 GB | `qwen3:8b` for everything | Fits in memory with room for OS |
| 16 GB | `qwen3:14b` standard, `qwen3:8b` fast | Best balance of quality and speed |
| 32+ GB | `qwen3:32b` reasoning, `qwen3:14b` standard | Full power for complex tasks |

Apple Silicon unified memory, NVIDIA VRAM, and CPU-only systems are all detected automatically. The agent tells you what it picked:

```
  provider: ollama (http://localhost:11434)
  models:   32 GB RAM → qwen3:32b for reasoning/powerful, qwen3:14b for standard
```

---

## For Developers

The CLI is built on `@agntk/core`, which you can use directly in your own projects:

```typescript
import { createAgent } from '@agntk/core';

const agent = createAgent({
  name: 'my-agent',
  instructions: 'You are a helpful coding assistant.',
  workspaceRoot: process.cwd(),
});

const result = await agent.stream({ prompt: 'Read package.json and list the dependencies' });

for await (const chunk of result.fullStream) {
  if (chunk.type === 'text-delta') process.stdout.write(chunk.text ?? '');
}
```

### Packages

| Package | Description |
|---------|-------------|
| `agntk` | CLI — `npx agntk` entry point |
| `@agntk/core` | Agent factory — tools, streaming, memory, sub-agents, hooks |
| `@agntk/cli` | CLI implementation |
| `@agntk/server` | HTTP server — REST + SSE + WebSocket endpoints |
| `@agntk/client` | Client library — HTTP, SSE, WebSocket |
| `@agntk/logger` | Structured logging with namespace filtering |

### Custom Tools

```typescript
const agent = createAgent({
  name: 'my-agent',
  tools: {
    myCustomTool: {
      description: 'Does something custom',
      parameters: z.object({ input: z.string() }),
      execute: async ({ input }) => ({ output: `Processed: ${input}` }),
    },
  },
});
```

Custom tools are merged with the 20+ built-in tools.

### Model Tiers

Every provider has 4 model tiers. Override via environment variables:

| Tier | Purpose | Env Override |
|------|---------|-------------|
| `fast` | Quick responses, low cost | `AGENT_SDK_MODEL_FAST` |
| `standard` | Balanced quality/cost | `AGENT_SDK_MODEL_STANDARD` |
| `reasoning` | Complex logic, planning | `AGENT_SDK_MODEL_REASONING` |
| `powerful` | Best quality, highest cost | `AGENT_SDK_MODEL_POWERFUL` |

### Server & Client

Expose any agent as an HTTP API:

```typescript
import { createAgentServer } from '@agntk/server';
import { createAgent } from '@agntk/core';

const agent = createAgent({ name: 'api-agent', instructions: 'You help with API tasks.' });
const server = createAgentServer({ agent, port: 3000 });
server.start();
// POST /stream, POST /chat, GET /health, WS /ws/browser-stream
```

Connect from anywhere:

```typescript
import { AgentHttpClient } from '@agntk/client';

const client = new AgentHttpClient('http://localhost:3000');
for await (const event of client.generateStream({ messages: [{ role: 'user', content: 'Hello' }] })) {
  if (event.type === 'text-delta') process.stdout.write(event.textDelta);
}
```

### Advanced Features

Available via sub-path imports:

```typescript
import { ... } from '@agntk/core';          // Core essentials
import { ... } from '@agntk/core/evals';     // Eval suite and assertions
import { ... } from '@agntk/core/advanced';  // Durability, hooks, guardrails, reflection, observability
```

Features include: durable workflows (crash recovery), workflow hooks (human-in-the-loop approval), guardrails (PII filtering), reflection (always-on self-critique), observability (Langfuse + OpenTelemetry), and best-of-N evaluation.

---

## Requirements

- Node.js >= 20
- For local models: [Ollama](https://ollama.com) (optional, auto-detected)

## License

MIT
