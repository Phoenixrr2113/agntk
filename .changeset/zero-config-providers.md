---
"@agntk/core": minor
"@agntk/cli": minor
"agntk": minor
---

Zero-config provider resolution with free tier

- Auto-detect AI provider: BYOK keys → Ollama → free tier (Cerebras)
- Hardware-aware model selection for Ollama (qwen3:8b/14b/32b based on RAM)
- System detection: Apple Silicon, NVIDIA VRAM, CPU-only
- Free tier proxy with rate limiting and daily budget
- Updated default Ollama models to Qwen3 (best tool-calling performance)
- CLI shows provider and model info on startup
