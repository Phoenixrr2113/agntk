# @agntk/server

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
