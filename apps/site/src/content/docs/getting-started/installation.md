---
title: Installation
description: Install Agent SDK in your project
---

# Installation

## Prerequisites

- **Node.js** >= 20
- **pnpm** >= 9 (or npm/yarn)

## Install from Monorepo

If you're working in the `agent-sdk` monorepo:

```bash
pnpm install
pnpm build
pnpm test
```

## Environment Setup

Set your API key to get started:

```bash
# Recommended: OpenRouter (routes to any model)
export OPENROUTER_API_KEY=sk-or-...

# Or use OpenAI directly
export OPENAI_API_KEY=sk-...

# For local models via Ollama
export OLLAMA_ENABLED=true
```

## Project Structure

```
agent-sdk/
├── packages/
│   ├── sdk/           # @agntk/core — Core agent factory
│   ├── cli/           # @agntk/cli — CLI agent
│   ├── sdk-server/    # @agntk/server — HTTP server
│   ├── sdk-client/    # @agntk/client — Client library
│   ├── logger/        # @agntk/logger — Structured logging
│   └── agntk/         # agntk — npx wrapper
├── apps/
│   └── site/          # Documentation site + API proxy
└── tests/
    └── integration/   # Integration tests
```

## Optional Dependencies

### Temporal (for Durable Workflows)

For production durable workflows, set up a Temporal server. See the [Durable Agents](/packages/sdk#durable-agents) guide for details.

## Next Steps

- [Quick Start](/getting-started/quick-start) — Build your first agent
- [SDK Core](/packages/sdk) — Learn about agents and tools
