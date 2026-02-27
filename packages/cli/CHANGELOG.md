# @agntk/cli

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
  - @agntk/core@0.3.0

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
  - @agntk/core@0.2.0

## 0.1.2

### Patch Changes

- 8c4f0cf: ci: add automated GitHub Release creation on publish
- Updated dependencies [8c4f0cf]
  - @agntk/core@0.1.2
