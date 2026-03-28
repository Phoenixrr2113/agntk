# @agntk/logger

## 1.2.7

### Patch Changes

- Improve CLI help output with an Environment Variables section, clearer option descriptions, and provider priority order documentation.

## 1.2.6

### Patch Changes

- Add JSDoc to all public API functions in @agntk/core; bump ai to 6.0.138; add security overrides for yaml, picomatch, smol-toml

## 1.2.5

### Patch Changes

- Update dependencies: ai 6.0.134→6.0.137, hono 4.12.8→4.12.9, vitest 4.1.0→4.1.1, typescript-eslint 8.57.1→8.57.2

## 1.2.4

### Patch Changes

- chore: update dependencies — vitest 4.1.0, turbo 2.8.20, @types/node 25.5.0, hono 4.12.8

## 1.2.3

### Patch Changes

- Sync linked package versions

## 1.2.2

### Patch Changes

- Improve package READMEs with npm badges, expanded API docs, and usage examples

## 0.3.3

### Patch Changes

- Sync linked package versions

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

## 0.1.2

### Patch Changes

- 8c4f0cf: ci: add automated GitHub Release creation on publish
