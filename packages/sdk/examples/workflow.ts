import { createAgent } from '@agntk/core';

async function basicStream() {
  const agent = createAgent({
    name: 'stream-example',
    instructions: 'You are a helpful coding assistant.',
    workspaceRoot: process.cwd(),
  });

  const result = await agent.stream({
    prompt: 'Explain what this project does based on the package.json',
  });

  for await (const chunk of result.fullStream) {
    switch (chunk.type) {
      case 'text-delta':
        process.stdout.write(chunk.text as string);
        break;
      case 'tool-call':
        console.log(`\n[Tool call: ${chunk.toolName}]`);
        break;
      case 'tool-result':
        console.log(`[Tool result received]`);
        break;
    }
  }

  const text = await result.text;
  const usage = await result.usage;
  console.log('\n\nCompleted.');
  console.log('Response length:', text.length);
  console.log('Usage:', usage);
}

async function multiStepStream() {
  const agent = createAgent({
    name: 'multi-step-example',
    instructions:
      'You are a thorough code reviewer. Read files carefully before providing feedback.',
    workspaceRoot: process.cwd(),
    maxSteps: 30,
  });

  const result = await agent.stream({
    prompt: 'Read the main source files and suggest improvements',
  });

  let stepCount = 0;
  for await (const chunk of result.fullStream) {
    if (chunk.type === 'text-delta') {
      process.stdout.write(chunk.text as string);
    } else if (chunk.type === 'tool-call') {
      stepCount++;
      console.log(`\n[Step ${stepCount}: ${chunk.toolName}]`);
    }
  }

  console.log(`\n\nTotal tool calls: ${stepCount}`);
}

async function main() {
  console.log('=== Basic Streaming ===');
  await basicStream();

  console.log('\n\n=== Multi-step Streaming ===');
  await multiStepStream();
}

main().catch(console.error);
