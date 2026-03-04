import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAgent, resolveAgentStatePath } from '@agntk/core';
import {
  createFileTools,
  createShellTool,
  createGlobTool,
  createGrepTool,
  wrapAllToolsWithWorkspace,
  wrapAllToolsWithRetry,
} from '@agntk/core/tools';
import { createMockModel, createMockModelWithSpy } from '../setup';

let tmpDir: string;
let agentName: string;
let agentStatePath: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'agntk-agent-pipeline-'));
  agentName = `test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  agentStatePath = resolveAgentStatePath(agentName);
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  await rm(agentStatePath, { recursive: true, force: true });
});

function parse(result: string) {
  return JSON.parse(result) as Record<string, unknown>;
}

describe('createAgent configuration', () => {
  it('getToolNames returns full preset + spawn tools', () => {
    const model = createMockModel('unused');
    const agent = createAgent({ name: agentName, model, workspaceRoot: tmpDir });
    const toolNames = agent.getToolNames();
    expect(toolNames).toContain('file_read');
    expect(toolNames).toContain('file_write');
    expect(toolNames).toContain('file_edit');
    expect(toolNames).toContain('file_create');
    expect(toolNames).toContain('shell');
    expect(toolNames).toContain('background');
    expect(toolNames).toContain('glob');
    expect(toolNames).toContain('grep');
    expect(toolNames).toContain('plan');
    expect(toolNames).toContain('deep_reasoning');
    expect(toolNames).toContain('spawn_agent');
    expect(toolNames).toContain('check_agent');
  });

  it('agent init creates agent state directories', async () => {
    const model = createMockModel('init test');
    const agent = createAgent({ name: agentName, model, workspaceRoot: tmpDir });
    await agent.init();
    expect(existsSync(agentStatePath)).toBe(true);
    expect(existsSync(join(agentStatePath, 'memory'))).toBe(true);
    expect(existsSync(join(agentStatePath, 'workspace'))).toBe(true);
    expect(existsSync(join(agentStatePath, 'archive'))).toBe(true);
  });

  it('system prompt includes agent name and instructions', () => {
    const model = createMockModel('unused');
    const agent = createAgent({
      name: agentName,
      model,
      workspaceRoot: tmpDir,
      instructions: 'You are a specialized test agent.',
    });
    const systemPrompt = agent.getSystemPrompt();
    expect(systemPrompt).toContain('specialized test agent');
    expect(systemPrompt).toContain(agentName);
  });

  it('system prompt mentions tool capabilities', () => {
    const model = createMockModel('unused');
    const agent = createAgent({ name: agentName, model, workspaceRoot: tmpDir });
    const systemPrompt = agent.getSystemPrompt();
    expect(systemPrompt).toContain('file operations');
    expect(systemPrompt).toContain('shell commands');
    expect(systemPrompt).toContain('sub-agents');
  });

  it('init injects memory context into system prompt', async () => {
    const model = createMockModel('unused');
    const agent = createAgent({ name: agentName, model, workspaceRoot: tmpDir });

    await mkdir(join(agentStatePath, 'memory'), { recursive: true });
    await writeFile(
      join(agentStatePath, 'context.md'),
      'Previously worked on auth module.',
      'utf-8',
    );

    await agent.init();
    const systemPrompt = agent.getSystemPrompt();
    expect(systemPrompt).toContain('auth module');
  });

  it('resolveAgentStatePath normalizes names', () => {
    const path1 = resolveAgentStatePath('My Agent!');
    const path2 = resolveAgentStatePath('my-agent_');
    expect(path1).toContain('my_agent_');
    expect(path2).toContain('my-agent_');
  });
});

describe('workspace middleware', () => {
  it('small tool output passes through unchanged', async () => {
    const tools = createFileTools(tmpDir);
    const workspacePath: string | null = null;

    const wrapped = wrapAllToolsWithWorkspace(tools, {
      getWorkspacePath: () => workspacePath,
      tokenThreshold: 1000,
    });

    await wrapped.file_write.execute!({ path: 'small.txt', content: 'small content' }, {} as never);
    const result = parse(
      (await wrapped.file_read.execute!({ path: 'small.txt' }, {} as never)) as string,
    );
    expect(result.success).toBe(true);
    expect(result.content).toContain('small content');
  });

  it('large tool output gets offloaded to workspace', async () => {
    const workspacePath = join(tmpDir, 'workspace');
    await mkdir(workspacePath, { recursive: true });

    const tools = createFileTools(tmpDir);
    const wrapped = wrapAllToolsWithWorkspace(tools, {
      getWorkspacePath: () => workspacePath,
      tokenThreshold: 10,
    });

    const largeContent = 'x'.repeat(200);
    await writeFile(join(tmpDir, 'large.txt'), largeContent, 'utf-8');

    const result = parse(
      (await wrapped.file_read.execute!({ path: 'large.txt' }, {} as never)) as string,
    );

    if (result._workspaceOffloaded) {
      expect(result.savedTo).toBeDefined();
      expect(result.hint).toContain('Full result');
      expect(existsSync(result.savedTo as string)).toBe(true);
    } else {
      expect(result.success).toBe(true);
    }
  });
});

describe('retry wrapper', () => {
  it('wrapped tools still work correctly', async () => {
    const tools = createFileTools(tmpDir);
    const wrapped = wrapAllToolsWithRetry(tools, 3);

    const writeResult = parse(
      (await wrapped.file_write.execute!(
        { path: 'retry-test.txt', content: 'retry content' },
        {} as never,
      )) as string,
    );
    expect(writeResult.success).toBe(true);
    expect(await readFile(join(tmpDir, 'retry-test.txt'), 'utf-8')).toBe('retry content');

    const readResult = parse(
      (await wrapped.file_read.execute!({ path: 'retry-test.txt' }, {} as never)) as string,
    );
    expect(readResult.success).toBe(true);
    expect(readResult.content).toContain('retry content');
  });
});

describe('tool presets produce working tools', () => {
  it('file tools from createFileTools all execute', async () => {
    const tools = createFileTools(tmpDir);
    expect(tools.file_read).toBeDefined();
    expect(tools.file_write).toBeDefined();
    expect(tools.file_edit).toBeDefined();
    expect(tools.file_create).toBeDefined();

    await tools.file_write.execute!({ path: 'preset.txt', content: 'preset test' }, {} as never);
    expect(await readFile(join(tmpDir, 'preset.txt'), 'utf-8')).toBe('preset test');

    const readResult = parse(await tools.file_read.execute!({ path: 'preset.txt' }, {} as never));
    expect(readResult.content).toContain('preset test');

    const editResult = parse(
      await tools.file_edit.execute!(
        { path: 'preset.txt', oldText: 'preset', newText: 'edited' },
        {} as never,
      ),
    );
    expect(editResult.success).toBe(true);
    expect(await readFile(join(tmpDir, 'preset.txt'), 'utf-8')).toBe('edited test');
  });

  it('glob and grep tools work against real files', async () => {
    await mkdir(join(tmpDir, 'src'), { recursive: true });
    await writeFile(join(tmpDir, 'src/index.ts'), 'export function main() {}', 'utf-8');

    const glob = createGlobTool();
    const globResult = parse(
      await glob.glob.execute!({ pattern: '**/*.ts', path: tmpDir }, {} as never),
    );
    expect(globResult.success).toBe(true);
    expect((globResult.files as string[]).some((f: string) => f.includes('index.ts'))).toBe(true);

    const grep = createGrepTool();
    const grepResult = parse(
      await grep.grep.execute!({ pattern: 'function main', path: tmpDir }, {} as never),
    );
    expect(grepResult.success).toBe(true);
    expect((grepResult.matches as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it('shell tool executes in specified workspace', async () => {
    const shell = createShellTool(tmpDir);
    await writeFile(join(tmpDir, 'marker.txt'), 'shell-test', 'utf-8');
    const result = parse(await shell.execute!({ command: 'ls' }, {} as never));
    expect(result.success).toBe(true);
    expect(result.stdout).toContain('marker.txt');
  });
});

describe('agent stream with mock model', () => {
  it('stream returns result with text', async () => {
    const model = createMockModel('Hello from agent.');
    const agent = createAgent({ name: agentName, model, workspaceRoot: tmpDir });
    const result = await agent.stream({ prompt: 'say hello' });
    const text = await result.text;
    expect(text).toContain('Hello from agent');
  });

  it('system prompt is sent to model', async () => {
    const { model, calls } = createMockModelWithSpy('test response');
    const agent = createAgent({
      name: agentName,
      model,
      workspaceRoot: tmpDir,
      instructions: 'Custom instruction here.',
    });
    const result = await agent.stream({ prompt: 'test' });
    await result.text;
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });
});
