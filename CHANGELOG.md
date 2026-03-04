# Changelog

## 1.0.0

### Breaking Changes

#### Memory System Redesign

- **Removed** `createMemoryTools()` and `MemoryToolsOptions` — agents no longer have `remember`, `recall`, `update_context`, `forget` tools
- **Removed** `extractAndUpdateMemory()`, `forgetFromMemory()`, `generateDecisionEntry()`, `EMPTY_MEMORY_MD`, `MemoryNetworkType` from `memory/extraction.ts`
- **Changed** `MemoryStore` interface — removed `loadMemory()` and `saveMemory()`, added directory-based methods (`listMemoryFiles()`, `createTaskFolder()`, `archiveTask()`, `getMemoryPath()`, `getWorkspacePath()`, `getArchivePath()`, `ensureDirectories()`, etc.)
- **Changed** `MarkdownMemoryStore` to match new interface — single-file `memory.md` replaced by `memory/` directory structure
- **Changed** `loadMemoryContext()` — now lists memory directory files instead of loading full `memory.md` content
- **Moved** decisions file from `.agntk/decisions.md` to `.agntk/memory/decisions.md`

#### Sub-Agent System Redesign

- **Removed** `subAgentConfigs`, `getSubAgentConfig()`, `subAgentRoles`, `SubAgentRole`, `SubAgentConfig` — role-based sub-agents replaced with task-based model
- **Changed** `spawnAgentParametersSchema` — removed `role` field, added `async` (boolean) and `model` (tier override)
- **Changed** `SpawnAgentOptions.createAgent` callback — now accepts `{ task, instructions, workspacePath, model?, tools? }` instead of `{ role, instructions? }`
- **Changed** `SpawnAgentResult` — now a discriminated union of `SpawnAgentSyncResult | SpawnAgentAsyncResult` with required `agentId` and `workspacePath`
- **Removed** `role` field from `SubAgentStreamData`

#### Model Resolution

- **Changed** `resolveModel()` — returns `ResolvedModel` (`{ model, modelId }`) instead of bare `LanguageModel`

#### Agent Interface

- **Added** required `getModelId(): string` method to `Agent` interface — custom implementations must add this

#### Defaults

- **Changed** `DEFAULT_MAX_STEPS` from `10` to `0` (unlimited)
- **Changed** CLI `--max-steps` default from `25` to `0` (unlimited)
- **Added** default `maxInputTokens: 4_000_000` usage limit — always applied even when `usageLimits` is not specified

### New Features

- **Workspace Middleware** — `wrapAllToolsWithWorkspace()` automatically offloads large tool results to workspace files
- **Refine Loop** — `withRefineLoop()` wrapper for iterative LLM-as-judge refinement
- **Agent Registry** — `AgentRegistry` class for tracking sub-agent lifecycle with disk persistence
- **Check Agent Tool** — `createCheckAgentTool()` for querying async sub-agent status
- **Async Sub-Agents** — sub-agents can run in background via `{ async: true }`
- **Model Tier Override** — sub-agents can specify `{ model: 'fast' | 'standard' | 'reasoning' }`
- **File Tool Options** — `FileToolOptions` with `allowedPaths` for extending file access beyond workspace root

### Migration

See [MIGRATION.md](./MIGRATION.md) for detailed upgrade instructions with before/after code examples.
