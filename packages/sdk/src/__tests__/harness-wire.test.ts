import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

vi.mock('ai', () => {
  return {
    ToolLoopAgent: class MockToolLoopAgent {
      constructor() {}
      stream() {
        return Promise.resolve({ fullStream: [], text: Promise.resolve(''), totalUsage: {} });
      }
    },
    stepCountIs: () => () => false,
    tool: (spec: Record<string, unknown>) => spec,
  };
});

vi.mock('../models', () => ({
  resolveModel: () => ({
    model: {},
    modelId: 'test-model',
  }),
}));

vi.mock('../observability', () => ({
  initObservability: vi.fn(),
  createTelemetrySettings: vi.fn(),
  shutdownObservability: vi.fn(),
}));

import { createAgent } from '../agent';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-wire-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function writeFile(relativePath: string, content: string): void {
  const fullPath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

describe('createAgent with harness config', () => {
  it('injects governance prompt when harness option provided', async () => {
    const harnessRoot = path.join(tmpDir, 'harness');

    writeFile(
      'harness/core.md',
      `## Purpose
Test agent purpose.

## Creator
Test

## Identity
Test identity.`,
    );

    writeFile(
      'harness/rules/r1.md',
      `---
id: test-rule
author: human
status: active
---
<!-- L1: Always be helpful -->
Be helpful.`,
    );

    const agent = createAgent({
      name: 'test-harness-agent',
      workspaceRoot: tmpDir,
      harness: { root: harnessRoot },
    });

    await agent.init();
    const prompt = agent.getSystemPrompt();

    expect(prompt).toContain('<governance>');
    expect(prompt).toContain('Test agent purpose.');
    expect(prompt).toContain('Always be helpful');
  });

  it('does not inject governance when harness option is absent', async () => {
    const agent = createAgent({
      name: 'test-no-harness',
      workspaceRoot: tmpDir,
    });

    await agent.init();
    const prompt = agent.getSystemPrompt();

    expect(prompt).not.toContain('<governance>');
  });

  it('handles missing harness directory gracefully', async () => {
    const agent = createAgent({
      name: 'test-missing-harness',
      workspaceRoot: tmpDir,
      harness: { root: path.join(tmpDir, 'nonexistent') },
    });

    await agent.init();
    const prompt = agent.getSystemPrompt();

    expect(prompt).not.toContain('<governance>');
  });
});
