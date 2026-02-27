---
title: Configuration
description: Configure Agent SDK with config files and environment variables
---

# Configuration System

The SDK uses a cascading config system (highest priority first):

1. **Environment variables** — `AGENT_SDK_MODEL_FAST`, `AGENT_SDK_DEFAULT_PROVIDER`, etc.
2. **Config file** — `agent-sdk.config.yaml`, `.agent-sdk.json`, etc.
3. **Programmatic** — `configure()` at runtime
4. **Defaults** — built-in fallbacks

## Configuration File

Create `agent-sdk.config.yaml` (or `.json`) in your project root:

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
    "shell": {
      "timeout": 30000
    },
    "glob": {
      "maxFiles": 100
    }
  },
  "maxSteps": 25
}
```

## Loading Configuration

```typescript
import { loadConfig, configure, getConfig, resolveModel } from '@agntk/core';

// Load from file
const config = loadConfig('./agent-sdk.config.json');

// Override programmatically
configure({ models: { defaultProvider: 'openrouter' } });

// Get current config
const current = getConfig();

// Resolve models by tier
const model = resolveModel({ tier: 'powerful' });
const fastModel = resolveModel({
  tier: 'fast',
  provider: 'openrouter'
});
```

## Providers

All providers use `@ai-sdk/openai-compatible` for unified access:

| Provider | Default | Description |
|----------|---------|-------------|
| `openrouter` | ✅ | Routes to any model — Anthropic, Google, Meta, etc. |
| `openai` | | Direct OpenAI API |
| `ollama` | | Local models via Ollama |
| Custom | | Any OpenAI-compatible API via `customProviders` |

Set your API key:

```bash
# Primary (recommended)
export OPENROUTER_API_KEY=sk-or-...

# Or use OpenAI directly
export OPENAI_API_KEY=sk-...

# For local models
export OLLAMA_ENABLED=true
```

## Model Tiers

| Tier | Purpose | OpenRouter Default |
|------|---------|-------------------|
| `fast` | Quick responses, low cost | `x-ai/grok-4.1-fast` |
| `standard` | Balanced quality/cost | `google/gemini-3-flash-preview` |
| `reasoning` | Complex logic, planning | `deepseek/deepseek-r1` |
| `powerful` | Best quality, highest cost | `z-ai/glm-4.7` |

Override per-tier models via environment variables: `AGENT_SDK_MODEL_FAST`, `AGENT_SDK_MODEL_STANDARD`, `AGENT_SDK_MODEL_REASONING`, `AGENT_SDK_MODEL_POWERFUL`.

## Tool Configuration

Configure tool behavior:

```json
{
  "tools": {
    "shell": {
      "timeout": 30000,
      "maxOutput": 10000
    },
    "glob": {
      "maxFiles": 100
    },
    "browser": {
      "headless": true
    }
  }
}
```

## Custom Providers

Add any OpenAI-compatible API as a custom provider:

```json
{
  "models": {
    "customProviders": {
      "together": {
        "baseURL": "https://api.together.xyz/v1",
        "apiKeyEnv": "TOGETHER_API_KEY"
      }
    }
  }
}
```

## Next Steps

- [SDK Core](/packages/sdk) — Learn about agent options
- [Quick Start](/getting-started/quick-start) — Build your first agent
