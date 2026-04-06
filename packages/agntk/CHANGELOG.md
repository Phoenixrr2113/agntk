# agntk

## 1.3.1

### Patch Changes

- Updated dependencies
  - @agntk/cli@1.3.1

## 1.3.0

### Minor Changes

- feat: slash command registry, REPL autocomplete, shell completions, and update checker
  - Slash command registry with TAB completion in the REPL (works on first run, zero setup)
  - 10 built-in slash commands: /help, /tools, /verbose, /exit, /quit, /agents, /memory, /model, /clear, /status
  - Shell completion scripts for bash, zsh, and fish (agntk completions <shell>)
  - Auto-install shell completions when agntk is globally installed
  - Update checker that notifies when a newer version is available on npm

### Patch Changes

- Updated dependencies
  - @agntk/cli@1.3.0

## 1.2.8

### Patch Changes

- Updated dependencies
  - @agntk/cli@1.2.8

## 1.2.7

### Patch Changes

- Improve CLI help output with an Environment Variables section, clearer option descriptions, and provider priority order documentation.
- Updated dependencies
  - @agntk/cli@1.2.7

## 1.2.6

### Patch Changes

- Add JSDoc to all public API functions in @agntk/core; bump ai to 6.0.138; add security overrides for yaml, picomatch, smol-toml
- Updated dependencies
  - @agntk/cli@1.2.6

## 1.2.5

### Patch Changes

- Update dependencies: ai 6.0.134→6.0.137, hono 4.12.8→4.12.9, vitest 4.1.0→4.1.1, typescript-eslint 8.57.1→8.57.2
- Updated dependencies
  - @agntk/cli@1.2.5

## 1.2.4

### Patch Changes

- chore: update dependencies — vitest 4.1.0, turbo 2.8.20, @types/node 25.5.0, hono 4.12.8
- Updated dependencies
  - @agntk/cli@1.2.4

## 1.2.3

### Patch Changes

- @agntk/cli@1.2.3

## 1.2.2

### Patch Changes

- Improve package READMEs with npm badges, expanded API docs, and usage examples
- Updated dependencies
  - @agntk/cli@1.2.2

## 1.2.1

### Patch Changes

- Updated dependencies
  - @agntk/cli@1.2.1

## 1.1.0

### Minor Changes

- Add conversational follow-up mode and live sub-agent activity streaming

### Patch Changes

- Updated dependencies
  - @agntk/cli@1.1.0

## 0.3.5

### Patch Changes

- Updated dependencies
  - @agntk/cli@0.3.5

## 0.3.3

### Patch Changes

- Sync linked package versions
  - @agntk/cli@0.3.3

## 0.3.0

### Minor Changes

- 057ffb2: Zero-config provider resolution with free tier
  - Auto-detect AI provider: BYOK keys → Ollama → free tier (Cerebras)
  - Hardware-aware model selection for Ollama (qwen3:8b/14b/32b based on RAM)
  - System detection: Apple Silicon, NVIDIA VRAM, CPU-only
  - Free tier proxy with rate limiting and daily budget
  - Updated default Ollama models to Qwen3 (best tool-calling performance)
  - CLI shows provider and model info on startup

### Patch Changes

- Updated dependencies [057ffb2]
  - @agntk/cli@0.3.0

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
  - @agntk/cli@0.2.0

## 0.1.2

### Patch Changes

- 8c4f0cf: ci: add automated GitHub Release creation on publish
- Updated dependencies [8c4f0cf]
  - @agntk/cli@0.1.2
