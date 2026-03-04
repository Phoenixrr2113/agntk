/**
 * @fileoverview Memory integration example.
 * Demonstrates semantic memory for context persistence.
 *
 * Memory is always enabled in createAgent — the agent automatically
 * has access to remember, recall, and forget tools.
 */

import { createAgent } from '@agntk/core';

async function main() {
  const agent = createAgent({
    name: 'memory-example',
    instructions: `You are a researcher. Store important findings as files in your memory/ directory.
Name files by topic (e.g. auth-patterns.md, api-design.md).
Use grep to search your memory files when recalling past findings.`,
    workspaceRoot: process.cwd(),
  });

  console.log('=== First Conversation ===');
  const result1 = await agent.stream({
    prompt: `Research the authentication patterns in this codebase.
Save your findings to a descriptive file in your memory/ directory.`,
  });

  for await (const chunk of result1.fullStream) {
    if (chunk.type === 'text-delta') {
      process.stdout.write(chunk.text as string);
    }
  }
  console.log('\n');

  console.log('=== Later Conversation ===');
  const result2 = await agent.stream({
    prompt: `What authentication patterns were found earlier?
Search your memory/ directory for relevant files.`,
  });

  for await (const chunk of result2.fullStream) {
    if (chunk.type === 'text-delta') {
      process.stdout.write(chunk.text as string);
    }
  }
  console.log('\n');
}

main().catch(console.error);
