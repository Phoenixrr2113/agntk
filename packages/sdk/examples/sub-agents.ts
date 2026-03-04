import { createAgent } from '@agntk/core';

async function main() {
  const coordinator = createAgent({
    name: 'coordinator',
    instructions: `You are a project coordinator.
Delegate specific tasks to sub-agents using spawn_agent.
Use async: true to run multiple sub-agents in parallel.
Use check_agent to poll their status.
Focus on planning and synthesis.`,
    workspaceRoot: process.cwd(),
  });

  const result = await coordinator.stream({
    prompt: `Analyze this codebase:
1. Spawn a sub-agent to review the main source files
2. Spawn a sub-agent to find relevant documentation patterns
3. Synthesize their findings into recommendations`,
  });

  for await (const chunk of result.fullStream) {
    switch (chunk.type) {
      case 'text-delta':
        process.stdout.write(chunk.text as string);
        break;
      case 'tool-call':
        if (chunk.toolName === 'spawn_agent') {
          console.log(`\n[Spawning sub-agent: ${(chunk.args as Record<string, string>).task}]`);
        }
        break;
    }
  }

  const text = await result.text;
  console.log('\n\nCoordinator result length:', text.length);
}

main().catch(console.error);
