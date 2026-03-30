# @agntk/server

## 1.2.8

### Patch Changes

- chore: update @hono/node-server to 1.19.12; add comprehensive unit tests for parseCLIArgs covering all flags, commands, edge cases, and combined usage patterns

## 1.2.7

### Patch Changes

- Improve CLI help output with an Environment Variables section, clearer option descriptions, and provider priority order documentation.
- Updated dependencies
  - @agntk/core@1.2.7
  - @agntk/logger@1.2.7

## 1.2.6

### Patch Changes

- Add JSDoc to all public API functions in @agntk/core; bump ai to 6.0.138; add security overrides for yaml, picomatch, smol-toml
- Updated dependencies
  - @agntk/core@1.2.6
  - @agntk/logger@1.2.6

## 1.2.5

### Patch Changes

- Update dependencies: ai 6.0.134→6.0.137, hono 4.12.8→4.12.9, vitest 4.1.0→4.1.1, typescript-eslint 8.57.1→8.57.2
- Updated dependencies
- Updated dependencies
  - @agntk/core@1.2.5
  - @agntk/logger@1.2.5

## 1.2.4

### Patch Changes

- chore: update dependencies — vitest 4.1.0, turbo 2.8.20, @types/node 25.5.0, hono 4.12.8
- Updated dependencies
- Updated dependencies
  - @agntk/core@1.2.4
  - @agntk/logger@1.2.4

## 1.2.3

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @agntk/core@1.2.3

## 1.2.2

### Patch Changes

- Improve package READMEs with npm badges, expanded API docs, and usage examples
- Updated dependencies
  - @agntk/core@1.2.2
  - @agntk/logger@1.2.2

## 1.2.1

### Patch Changes

- Updated dependencies
  - @agntk/core@1.2.1

## 1.1.0

### Patch Changes

- Updated dependencies
  - @agntk/core@1.1.0

## 0.3.5

### Patch Changes

- Updated dependencies
  - @agntk/core@0.3.5

## 0.3.3

### Patch Changes

- Sync linked package versions
- Updated dependencies
  - @agntk/logger@0.3.3
  - @agntk/core@0.3.3

## 0.3.0

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
  - @agntk/logger@0.2.0

## 0.1.2

### Patch Changes

- 8c4f0cf: ci: add automated GitHub Release creation on publish
- Updated dependencies [8c4f0cf]
  - @agntk/core@0.1.2
  - @agntk/logger@0.1.2
