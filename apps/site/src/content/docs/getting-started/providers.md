---
title: "Zero-Config Providers"
description: "Automatic provider resolution — BYOK, Ollama, free tier"
---

agntk auto-detects the best available AI provider:

| Priority | Provider | How it's detected |
|----------|----------|-------------------|
| 1 | **Your API key** | `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, or `CEREBRAS_API_KEY` in env |
| 2 | **Ollama** | Auto-detected at `localhost:11434` — picks the right model for your hardware |
| 3 | **Free tier** | Built-in, no setup — backed by Cerebras (rate-limited) |

```bash
# Use your own key for unlimited access (recommended)
export OPENROUTER_API_KEY=sk-or-...

# Or use local models — just install Ollama, agntk finds it automatically
# https://ollama.com

# Or just run it — the free tier works out of the box
npx agntk "hello"
```

---
