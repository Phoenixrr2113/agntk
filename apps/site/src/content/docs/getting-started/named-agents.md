---
title: "Named Agents & Memory"
description: "Persistent agents with memory across sessions"
---

Give an agent a name and it remembers context across sessions:

```bash
# First session — agent learns about your project
npx agntk -n myproject "read the codebase and understand the architecture"

# Later session — agent already knows the context
npx agntk -n myproject "add rate limiting to the API endpoints"

# See what agents exist
npx agntk list
```

Memory is stored at `~/.agntk/agents/{name}/` as plain markdown files:

| File | Description |
|------|-------------|
| `memory.md` | Agent-curated facts about your project |
| `context.md` | Session context the agent rewrites as it learns |
| `decisions.md` | Append-only log of decisions made |
| `preferences.md` | Cross-project preferences |
| `identity.md` | Human-authored identity (you can edit this) |
| `project.md` | Human-authored project context |

---
