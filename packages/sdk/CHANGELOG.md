# @agntk/core

## 1.2.6

### Patch Changes

- Add JSDoc to all public API functions in @agntk/core; bump ai to 6.0.138; add security overrides for yaml, picomatch, smol-toml
- Updated dependencies
  - @agntk/logger@1.2.6
  - @agntk/search@1.2.6

## 1.2.5

### Patch Changes

- Update dependencies: ai 6.0.134→6.0.137, hono 4.12.8→4.12.9, vitest 4.1.0→4.1.1, typescript-eslint 8.57.1→8.57.2
- Add null/undefined safety checks: array bounds in system-detect and best-of-n, optional chaining in config loader and skills loader, null fallbacks in duckduckgo provider, replace non-null assertions in search resolver
- Updated dependencies
- Updated dependencies
  - @agntk/logger@1.2.5
  - @agntk/search@1.0.3

## 1.2.4

### Patch Changes

- chore: update dependencies — vitest 4.1.0, turbo 2.8.20, @types/node 25.5.0, hono 4.12.8
- fix: improve error messages across core SDK with [agntk] prefix and actionable context
- Updated dependencies
  - @agntk/logger@1.2.4
  - @agntk/search@1.0.2

## 1.2.3

### Patch Changes

- Update `ai` dependency from 6.0.105 to 6.0.116
- Fix glob and grep tools when ripgrep (rg) is not installed: use `find` instead of `grep` binary for file discovery, strip path prefixes from glob patterns for `find -name` compatibility, and add `-E` flag to enable extended regex in grep fallback

## 1.2.2

### Patch Changes

- Improve package READMEs with npm badges, expanded API docs, and usage examples
- Updated dependencies
  - @agntk/logger@1.2.2
  - @agntk/search@1.0.1

## 1.2.1

### Patch Changes

- Fix cleanAgents() to recursively delete sub-agents and update default model defaults

## 1.1.0

### Minor Changes

- Add conversational follow-up mode and live sub-agent activity streaming

## 0.3.5

### Patch Changes

- Auto-generated changeset from conventional commits:
  - **@agntk/cli** (patch): refactor: decompose CLI monolith, remove dead code, fix deps
  - **@agntk/core** (patch): refactor: decompose CLI monolith, remove dead code, fix deps

## 0.3.3

### Patch Changes

- Updated dependencies
  - @agntk/logger@0.3.3

## 0.3.0

### Minor Changes

- 057ffb2: Zero-config provider resolution with free tier
  - Auto-detect AI provider: BYOK keys → Ollama → free tier (Cerebras)
  - Hardware-aware model selection for Ollama (qwen3:8b/14b/32b based on RAM)
  - System detection: Apple Silicon, NVIDIA VRAM, CPU-only
  - Free tier proxy with rate limiting and daily budget
  - Updated default Ollama models to Qwen3 (best tool-calling performance)
  - CLI shows provider and model info on startup

## 0.2.0

### Minor Changes

- ### Breaking Changes
  - **Unified Agent API**: `createAgent()` now uses `name` and `instructions` instead of `role` and `toolPreset`
  - **Removed**: Legacy workflow builders (`adapt`, `parallel`, `pipeline`), team coordination (`createTeam`), agent pooling (`SpecialistPool`), workflow schedulers, and workflow templates
  - **Removed**: Role registry and preset role system (`role-registry`, `roles.ts`)

  ### New Features
  - Simplified `createAgent()` API with automated internal configuration
  - Overhauled CLI with consolidated single-file architecture
  - Auto-sync README to docs site

  ### Fixes & Improvements
  - Updated SDK server routes and types for new agent model
  - Cleaned up exports and reduced bundle size
  - Updated documentation and examples throughout

### Patch Changes

- Updated dependencies
  - @agntk/logger@0.2.0

## 0.1.2

### Patch Changes

- 8c4f0cf: ci: add automated GitHub Release creation on publish
- Updated dependencies [8c4f0cf]
  - @agntk/logger@0.1.2
