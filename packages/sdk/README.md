# @agntk/core

Core agent factory for the Agent SDK. Built on [Vercel AI SDK](https://ai-sdk.dev).

## Installation

```bash
pnpm add @agntk/core
```

## Quick Start

```typescript
import { createAgent } from '@agntk/core';

const agent = createAgent({
  name: 'my-agent',
  instructions: 'You are a helpful coding assistant.',
  workspaceRoot: process.cwd(),
});

const result = await agent.stream({
  prompt: 'Read package.json and summarize the dependencies',
});

for await (const chunk of result.fullStream) {
  if (chunk.type === 'text-delta') process.stdout.write(chunk.text ?? '');
}

const text = await result.text;
```

## Agent Interface

```typescript
interface Agent {
  readonly name: string;

  init(): Promise<void>; // Called automatically by stream()
  stream(input: { prompt: string }): Promise<AgentStreamResult>;

  getSystemPrompt(): string;
  getToolNames(): string[];
}

interface AgentStreamResult {
  fullStream: AsyncIterable<StreamChunk>; // All event types
  text: PromiseLike<string>; // Final accumulated text
  usage: PromiseLike<LanguageModelUsage>; // Token usage
}
```

## `createAgent(options)`

| Option               | Type                      | Default         | Description                                                |
| -------------------- | ------------------------- | --------------- | ---------------------------------------------------------- |
| `name`               | `string`                  | **required**    | Display name — used in logs, traces, and persistent memory |
| `instructions`       | `string`                  | None            | Natural language context injected as the system prompt     |
| `workspaceRoot`      | `string`                  | `process.cwd()` | Root for file operations                                   |
| `maxSteps`           | `number`                  | `25`            | Max tool-loop iterations                                   |
| `model`              | `LanguageModel`           | Auto-resolved   | AI SDK model instance (optional override)                  |
| `usageLimits`        | `UsageLimits`             | None            | Token and request caps                                     |
| `tools`              | `Record<string, Tool>`    | `{}`            | Custom tools (merged with built-in tools)                  |
| `onSubAgentActivity` | `SubAgentActivityHandler` | None            | Callback for live sub-agent stream chunks                  |

## Built-in Tools

Every agent comes with 20 built-in tools:

| Category       | Tools                                                                 |
| -------------- | --------------------------------------------------------------------- |
| **Files**      | `file_read`, `file_write`, `file_edit`, `file_create`, `glob`, `grep` |
| **Code**       | `ast_grep_search`, `ast_grep_replace`                                 |
| **Shell**      | `shell`, `background`                                                 |
| **Planning**   | `plan`, `deep_reasoning`                                              |
| **Memory**     | `remember`, `recall`, `update_context`, `forget`                      |
| **Sub-Agents** | `spawn_agent`                                                         |
| **Skills**     | `search_skills`                                                       |
| **Progress**   | `progress_read`, `progress_update`                                    |
| **Browser**    | `browser`                                                             |

```typescript
const agent = createAgent({
  name: 'my-agent',
  tools: { myCustomTool }, // Custom tools merge with built-in tools
});
```

## Configuration

### Config File

Place `agent-sdk.config.yaml` (or `.json`) in your project root:

```json
{
  "models": {
    "defaultProvider": "openrouter",
    "tiers": {
      "fast": "x-ai/grok-4.1-fast",
      "standard": "google/gemini-3-flash-preview",
      "reasoning": "deepseek/deepseek-r1",
      "powerful": "anthropic/claude-sonnet-4"
    }
  },
  "tools": {
    "shell": { "timeout": 30000 },
    "glob": { "maxFiles": 100 }
  }
}
```

### Programmatic

```typescript
import { loadConfig, configure, getConfig, defineConfig, resolveModel } from '@agntk/core';

loadConfig('./agent-sdk.config.yaml');
configure({ models: { defaultProvider: 'openrouter' } });

const model = resolveModel({ tier: 'powerful' });
const config = getConfig();
```

## Providers

All providers use `@ai-sdk/openai-compatible` for unified access:

| Provider     | Default | Description                                            |
| ------------ | ------- | ------------------------------------------------------ |
| `openrouter` | ✅      | Routes to any model (Anthropic, Google, Meta, etc.)    |
| `openai`     |         | Direct OpenAI API                                      |
| `ollama`     |         | Local models via Ollama                                |
| Custom       |         | Any OpenAI-compatible API via `customProviders` config |

## Model Tiers

| Tier        | Purpose                         |
| ----------- | ------------------------------- |
| `fast`      | Quick responses, low cost       |
| `standard`  | Balanced quality/cost           |
| `reasoning` | Complex logic, chain-of-thought |
| `powerful`  | Best quality, highest cost      |

## Memory

Memory is always enabled. State is stored at `~/.agntk/agents/{name}/`:

```typescript
const agent = createAgent({ name: 'my-agent' });
// Memory tools are always available: remember, recall, update_context, forget
// Memory context is auto-loaded into the system prompt on first stream()
```

## Workflow Hooks

```typescript
import { defineHook, getHookRegistry } from '@agntk/core/advanced';

const hook = defineHook<{ amount: number }, boolean>({
  name: 'purchase-approval',
  timeout: '30m',
  defaultValue: false,
});

const approved = await hook.wait({ amount: 5000 });
```

## Duration Utilities

```typescript
import { parseDuration, formatDuration } from '@agntk/core/advanced';

parseDuration('2h'); // 7200000
formatDuration(7200000); // "2h"
```

## Skills

```typescript
import { createAgent, discoverSkills } from '@agntk/core';
import { buildSkillsSystemPrompt } from '@agntk/core/advanced';

// Auto-discover from default directories:
const agent = createAgent({ name: 'my-agent' });

// Manual:
const skills = await discoverSkills('./.agents/skills');
const prompt = buildSkillsSystemPrompt(skills);
```

## License

MIT
