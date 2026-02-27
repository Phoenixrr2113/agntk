---
title: "SDK & Packages"
description: "createAgent() API, custom tools, server, client, model tiers"
---

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

## Packages

| Package | Description |
|---------|-------------|
| `agntk` | CLI — `npx agntk` entry point |
| `@agntk/core` | Agent factory — tools, streaming, memory, sub-agents, hooks |
| `@agntk/cli` | CLI implementation |
| `@agntk/server` | HTTP server — REST + SSE + WebSocket endpoints |
| `@agntk/client` | Client library — HTTP, SSE, WebSocket |
| `@agntk/logger` | Structured logging with namespace filtering |

## Custom Tools

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

## Model Tiers

Every provider has 4 model tiers. Override via environment variables:

| Tier | Purpose | Env Override |
|------|---------|-------------|
| `fast` | Quick responses, low cost | `AGENT_SDK_MODEL_FAST` |
| `standard` | Balanced quality/cost | `AGENT_SDK_MODEL_STANDARD` |
| `reasoning` | Complex logic, planning | `AGENT_SDK_MODEL_REASONING` |
| `powerful` | Best quality, highest cost | `AGENT_SDK_MODEL_POWERFUL` |

## Server & Client

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

## Advanced Features

Available via sub-path imports:

```typescript
import { ... } from '@agntk/core';          // Core essentials
import { ... } from '@agntk/core/evals';     // Eval suite and assertions
import { ... } from '@agntk/core/advanced';  // Durability, hooks, guardrails, reflection, observability
```

Features include: durable workflows (crash recovery), workflow hooks (human-in-the-loop approval), guardrails (PII filtering), reflection (always-on self-critique), observability (Langfuse + OpenTelemetry), and best-of-N evaluation.

---
