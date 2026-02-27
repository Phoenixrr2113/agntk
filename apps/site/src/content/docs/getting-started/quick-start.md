---
title: Quick Start
description: Build your first agent with Agent SDK
---

# Quick Start

```bash
# One-shot: give it a task
npx agntk "organize this folder by file type"

# Named agent: remembers context across sessions
npx agntk -n coder "refactor the auth module to use JWT"

# Interactive REPL
npx agntk -n coder -i

# Pipe input
cat error.log | npx agntk "explain these errors and suggest fixes"

# List your agents
npx agntk list
```

That's it. No config files. No API key setup (unless you want to). It reads your files, runs commands, browses the web, spawns sub-agents, and remembers what it learns.

---

## Creating an Agent

Custom Tools

```typescript
const agent = createAgent({
  name: 'my-agent',
  tools: {
    myCustomTool: {
      description: 'Does something custom',
      parameters: z.object({ input: z.string() }),
      execute: async ({ input }) => ({ output: `Processed: ${input}` }),
    },
  },
});
```

Custom tools are merged with the 20+ built-in tools.


## Next Steps

- [SDK Core](/packages/sdk) — Full agent configuration reference
- [CLI](/packages/cli) — Use agents from the command line
- [Configuration](/configuration/yaml-config) — Configuration system
