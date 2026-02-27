---
title: "Local Inference"
description: "Ollama auto-detection and hardware-aware model selection"
---

When Ollama is detected, agntk checks your hardware and picks the largest model your system can run comfortably:

| Your RAM | Model Selected | Why |
|----------|---------------|-----|
| 8 GB | `qwen3:8b` for everything | Fits in memory with room for OS |
| 16 GB | `qwen3:14b` standard, `qwen3:8b` fast | Best balance of quality and speed |
| 32+ GB | `qwen3:32b` reasoning, `qwen3:14b` standard | Full power for complex tasks |

Apple Silicon unified memory, NVIDIA VRAM, and CPU-only systems are all detected automatically. The agent tells you what it picked:

```
  provider: ollama (http://localhost:11434)
  models:   32 GB RAM → qwen3:32b for reasoning/powerful, qwen3:14b for standard
```

---
