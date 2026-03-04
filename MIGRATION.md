# Migrating to v1.0.0

This guide covers all breaking changes from v0.3.x to v1.0.0 and how to update your code.

## Quick Reference

| Area                                                   | Breaking Change                                                          | Impact |
| ------------------------------------------------------ | ------------------------------------------------------------------------ | ------ |
| [Model Resolution](#1-model-resolution)                | `resolveModel()` returns `{ model, modelId }` instead of `LanguageModel` | HIGH   |
| [Memory Tools](#2-memory-tools-removed)                | `createMemoryTools()` removed entirely                                   | HIGH   |
| [Memory Store](#3-memory-store-interface)              | `MemoryStore` interface restructured                                     | HIGH   |
| [Memory Loading](#4-memory-loading)                    | Single-file `memory.md` replaced by directory-based memory               | HIGH   |
| [Sub-Agent Configs](#5-sub-agent-role-configs-removed) | `subAgentConfigs`, `SubAgentRole`, `getSubAgentConfig()` removed         | HIGH   |
| [Spawn Agent](#6-spawn-agent-tool)                     | Role-based spawning replaced with task-based spawning                    | HIGH   |
| [Agent Interface](#7-agent-interface)                  | New required `getModelId()` method                                       | MEDIUM |
| [Max Steps Default](#8-max-steps-default)              | Default changed from 10/25 to unlimited (0)                              | HIGH   |
| [Usage Limits](#9-default-usage-limits)                | 4M input token limit now always applied                                  | MEDIUM |
| [Decisions File](#10-decisions-file-location)          | Moved from `.agntk/decisions.md` to `.agntk/memory/decisions.md`         | MEDIUM |

---

## 1. Model Resolution

`resolveModel()` now returns a `ResolvedModel` object instead of a bare `LanguageModel`.

**Before (v0.3.x):**

```ts
import { resolveModel } from '@agntk/core';

const model = resolveModel({ tier: 'fast' });
// model is LanguageModel — pass directly to AI SDK
const result = await generateText({ model, prompt: '...' });
```

**After (v1.0.0):**

```ts
import { resolveModel } from '@agntk/core';

const { model, modelId } = resolveModel({ tier: 'fast' });
// model is LanguageModel, modelId is the string identifier
const result = await generateText({ model, prompt: '...' });
```

**Quick fix:** Add `.model` to every `resolveModel()` call site, or destructure `{ model }`.

---

## 2. Memory Tools Removed

The LLM-powered memory tools (`remember`, `recall`, `update_context`, `forget`) have been removed. Agents now use standard file tools to interact with a workspace directory structure.

**Before (v0.3.x):**

```ts
import { createMemoryTools } from '@agntk/core/advanced';
// or
import { createMemoryTools } from '@agntk/core/tools';

const memoryTools = createMemoryTools({
  store: myMemoryStore,
  model: myModel,
});

const agent = createAgent({
  name: 'my-agent',
  tools: { ...memoryTools, ...otherTools },
});
```

**After (v1.0.0):**

Memory is now handled automatically by `createAgent()`. It creates a `MarkdownMemoryStore`, sets up workspace directories (`.agntk/memory/`, `.agntk/workspace/`, `.agntk/archive/`), and injects workspace instructions into the system prompt. Agents read and write memory using the built-in file tools.

```ts
const agent = createAgent({
  name: 'my-agent',
  tools: { ...otherTools },
  // Memory is configured automatically
});
```

If you need custom memory behavior, implement the `MemoryStore` interface (see section 3).

**Also removed** (from `memory/extraction.ts`):

- `extractAndUpdateMemory()`
- `forgetFromMemory()`
- `generateDecisionEntry()`
- `EMPTY_MEMORY_MD`
- `MemoryNetworkType`

These have no direct replacements. Memory curation is no longer LLM-driven.

---

## 3. Memory Store Interface

The `MemoryStore` interface has been restructured from a single-file model to a directory-based model.

**Before (v0.3.x):**

```ts
interface MemoryStore {
  loadIdentity(): Promise<string | null>;
  loadPreferences(): Promise<string | null>;
  loadProject(): Promise<string | null>;
  loadMemory(): Promise<string | null>; // ← removed
  loadContext(): Promise<string | null>;
  loadDecisions(): Promise<string | null>;
  saveContext(content: string): Promise<void>;
  saveMemory(content: string): Promise<void>; // ← removed
  savePreferences(content: string): Promise<void>;
  appendDecision(entry: string): Promise<void>;
}
```

**After (v1.0.0):**

```ts
interface MemoryStore {
  // Unchanged
  loadIdentity(): Promise<string | null>;
  loadPreferences(): Promise<string | null>;
  loadProject(): Promise<string | null>;
  loadContext(): Promise<string | null>;
  loadDecisions(): Promise<string | null>;
  saveContext(content: string): Promise<void>;
  savePreferences(content: string): Promise<void>;
  appendDecision(entry: string): Promise<void>;

  // New — directory-based memory
  listMemoryFiles(): Promise<string[]>;
  createTaskFolder(label: string): Promise<string>;
  archiveTask(taskFolderName: string): Promise<void>;
  getCurrentTaskPath(): Promise<string | null>;
  getProjectPath(): string;
  getGlobalPath(): string;
  getMemoryPath(): string;
  getWorkspacePath(): string;
  getArchivePath(): string;
  ensureDirectories(): Promise<void>;
}
```

**If you have a custom `MemoryStore` implementation:**

1. Remove `loadMemory()` and `saveMemory()` methods
2. Add all new methods listed above
3. See `MarkdownMemoryStore` in `packages/sdk/src/memory/store.ts` for a reference implementation

---

## 4. Memory Loading

The memory context injected into agent system prompts has changed fundamentally.

**Before (v0.3.x):** `loadMemoryContext()` loaded a single `memory.md` file and injected its full content into the prompt.

**After (v1.0.0):** `loadMemoryContext()` lists files in the `memory/` directory and tells the agent to read them on demand using file tools. This reduces prompt bloat.

**Directory structure:**

```
.agntk/
├── memory/          # Persistent knowledge files
│   └── decisions.md # Decision log (moved from .agntk/decisions.md)
├── workspace/       # Active task working area
│   └── current -> task-xyz/  # Symlink to current task
└── archive/         # Completed task folders
```

No code changes needed unless you were directly reading `memory.md` — that file no longer exists.

---

## 5. Sub-Agent Role Configs Removed

The predefined role-based sub-agent system has been removed in favor of task-based sub-agents.

**Before (v0.3.x):**

```ts
import {
  subAgentConfigs,
  getSubAgentConfig,
  subAgentRoles,
  type SubAgentRole,
} from '@agntk/core/advanced';

const config = getSubAgentConfig('coder');
// subAgentRoles: ['coder', 'researcher', 'analyst', 'generic']
```

**After (v1.0.0):**

These exports no longer exist. Sub-agents are now task-driven — they derive their instructions from the task description rather than a predefined role. Remove all imports of `subAgentConfigs`, `getSubAgentConfig`, `subAgentRoles`, and `SubAgentRole`.

If you need role-like behavior, pass role-specific instructions through the `context` field when spawning agents.

---

## 6. Spawn Agent Tool

The spawn agent tool has changed from role-based to task-based spawning, with support for async execution and model tier selection.

**Before (v0.3.x):**

```ts
// Tool input schema
{
  task: string;
  role: 'coder' | 'researcher' | 'analyst' | 'generic'; // default: 'generic'
  context?: string;
}

// createAgent callback
createAgent?: (options: { role: string; instructions?: string }) => { ... }

// Result type
interface SpawnAgentResult {
  success: boolean;
  agentId?: string;
  role?: string;
  summary?: string;
  message?: string;
  error?: string;
  suggestion?: string;
}

// Stream data
interface SubAgentStreamData {
  type: 'sub-agent-stream';
  agentId: string;
  role: string;           // ← removed
  text: string;
  status: 'streaming' | 'complete';
}
```

**After (v1.0.0):**

```ts
// Tool input schema
{
  task: string;
  context?: string;
  async: boolean;                                    // NEW — run in background
  model?: 'fast' | 'standard' | 'reasoning';        // NEW — model tier override
}

// createAgent callback
createAgent?: (options: {
  task: string;
  instructions: string;
  workspacePath: string;
  model?: 'fast' | 'standard' | 'reasoning';
  tools?: string[];
}) => {
  stream: (input: { prompt: string }) => {
    fullStream: AsyncIterable<...>;
    text: Promise<string>;
    usage: Promise<{ totalTokens?: number; ... }>;   // NEW — required
  };
}

// Result type — now a discriminated union
type SpawnAgentResult = SpawnAgentSyncResult | SpawnAgentAsyncResult;

interface SpawnAgentSyncResult {
  success: boolean;
  agentId: string;       // now required
  summary?: string;
  workspacePath: string; // NEW — required
  error?: string;
  errorType?: SpawnErrorType; // NEW
  message?: string;
}

interface SpawnAgentAsyncResult {
  success: true;
  agentId: string;
  workspacePath: string;
  status: 'running';
  message: string;
}

// Stream data — role field removed
interface SubAgentStreamData {
  type: 'sub-agent-stream';
  agentId: string;
  text: string;
  status: 'streaming' | 'complete';
}
```

**New companion tool:** `createCheckAgentTool()` lets you query the status of async sub-agents. It is automatically added by `createAgent()`.

**Migration steps:**

1. Remove any `role` references from spawn agent inputs
2. Update `createAgent` callbacks to accept the new options shape
3. Add `usage` to the stream return type
4. Update result type handling for the discriminated union
5. Remove `role` references from `SubAgentStreamData` consumers

---

## 7. Agent Interface

The `Agent` interface now requires a `getModelId()` method.

**Before (v0.3.x):**

```ts
interface Agent {
  readonly name: string;
  init(): Promise<void>;
  stream(input: { prompt: string }): Promise<AgentStreamResult>;
  getSystemPrompt(): string;
  getToolNames(): string[];
}
```

**After (v1.0.0):**

```ts
interface Agent {
  readonly name: string;
  init(): Promise<void>;
  stream(input: { prompt: string }): Promise<AgentStreamResult>;
  getSystemPrompt(): string;
  getToolNames(): string[];
  getModelId(): string; // NEW — required
}
```

**If you have a custom `Agent` implementation**, add:

```ts
getModelId(): string {
  return 'your-model-id';
}
```

Agents created via `createAgent()` implement this automatically.

---

## 8. Max Steps Default

The default maximum steps has changed from bounded to unlimited.

| Setting                   | v0.3.x | v1.0.0          |
| ------------------------- | ------ | --------------- |
| `DEFAULT_MAX_STEPS` (SDK) | `10`   | `0` (unlimited) |
| `--max-steps` (CLI)       | `25`   | `0` (unlimited) |

**Impact:** Agents without an explicit `maxSteps` will now run until they finish or hit a usage limit (see section 9), instead of stopping at 10/25 steps.

**To preserve old behavior:**

```ts
// SDK
const agent = createAgent({
  name: 'my-agent',
  maxSteps: 10, // explicitly set
});

// CLI
agntk run --max-steps 25
```

---

## 9. Default Usage Limits

A default input token limit is now always applied, even when `usageLimits` is not specified.

**Before (v0.3.x):** No usage limits unless explicitly configured.

**After (v1.0.0):** Default `maxInputTokens: 4_000_000` is always applied.

**To remove the limit:**

```ts
const agent = createAgent({
  name: 'my-agent',
  usageLimits: { maxInputTokens: Infinity },
});
```

**Note:** This limit works as a safety net alongside the new unlimited max steps default. Most agents will complete their work well within 4M input tokens.

---

## 10. Decisions File Location

The decisions log has moved from `.agntk/decisions.md` to `.agntk/memory/decisions.md`.

**Existing `.agntk/decisions.md` files will not be automatically migrated.** If you have decision history you want to preserve, manually move the file:

```bash
mkdir -p .agntk/memory
mv .agntk/decisions.md .agntk/memory/decisions.md
```

---

## New Features in v1.0.0

These are additive and don't require migration, but are worth knowing about:

### Workspace Middleware

Large tool results are automatically offloaded to workspace files to prevent context bloat. This is applied by `createAgent()` automatically.

```ts
import { wrapAllToolsWithWorkspace } from '@agntk/core/tools';
```

### Refine Loop Wrapper

Iterative refinement with LLM-as-judge evaluation:

```ts
import { withRefineLoop } from '@agntk/core/advanced';

const result = await withRefineLoop(agent, prompt, {
  criteria: 'Code correctness and test coverage',
  threshold: 0.8,
  maxIterations: 3,
});
```

### Agent Registry

Track spawned sub-agent lifecycle with disk persistence:

```ts
import { AgentRegistry } from '@agntk/core/advanced';
```

### Check Agent Tool

Query async sub-agent status:

```ts
import { createCheckAgentTool } from '@agntk/core/advanced';
```

### Async Sub-Agents

Sub-agents can now run in the background:

```ts
// Via the spawn_agent tool input
{ task: 'Analyze codebase', async: true }
```
