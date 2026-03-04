import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MarkdownMemoryStore, loadMemoryContext } from '@agntk/core';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'agntk-mem-pipeline-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function createStore() {
  return new MarkdownMemoryStore({
    projectDir: join(tmpDir, 'project'),
    globalDir: join(tmpDir, 'global'),
    workspaceRoot: tmpDir,
  });
}

describe('MarkdownMemoryStore', () => {
  it('ensureDirectories creates memory, workspace, archive dirs', async () => {
    const store = createStore();
    await store.ensureDirectories();

    expect(existsSync(store.getMemoryPath())).toBe(true);
    expect(existsSync(store.getWorkspacePath())).toBe(true);
    expect(existsSync(store.getArchivePath())).toBe(true);
  });

  it('saveContext/loadContext roundtrip', async () => {
    const store = createStore();
    await store.ensureDirectories();

    await store.saveContext('Current task: testing memory pipeline');
    const loaded = await store.loadContext();
    expect(loaded).toBe('Current task: testing memory pipeline');
  });

  it('appendDecision/loadDecisions', async () => {
    const store = createStore();
    await store.ensureDirectories();

    await store.appendDecision('## Decision 1\nUse TypeScript for all tests.');
    await store.appendDecision('## Decision 2\nUse vitest as the test framework.');
    const decisions = await store.loadDecisions();
    expect(decisions).toContain('Decision 1');
    expect(decisions).toContain('Decision 2');
    expect(decisions).toContain('vitest');
  });

  it('createTaskFolder creates folder and current symlink', async () => {
    const store = createStore();
    await store.ensureDirectories();

    const taskPath = await store.createTaskFolder('test-task');
    expect(existsSync(taskPath)).toBe(true);

    const currentPath = await store.getCurrentTaskPath();
    expect(currentPath).toBe(taskPath);
  });

  it('archiveTask moves folder from workspace to archive', async () => {
    const store = createStore();
    await store.ensureDirectories();

    const taskPath = await store.createTaskFolder('archive-test');
    await writeFile(join(taskPath, 'notes.md'), 'task notes', 'utf-8');

    const folderName = taskPath.split('/').pop()!;
    await store.archiveTask(folderName);

    expect(existsSync(taskPath)).toBe(false);
    const archivedPath = join(store.getArchivePath(), folderName);
    expect(existsSync(archivedPath)).toBe(true);
    expect(await readFile(join(archivedPath, 'notes.md'), 'utf-8')).toBe('task notes');
  });

  it('listMemoryFiles returns markdown files', async () => {
    const store = createStore();
    await store.ensureDirectories();

    const memDir = store.getMemoryPath();
    await writeFile(join(memDir, 'api-design.md'), '# API Design', 'utf-8');
    await writeFile(join(memDir, 'decisions.md'), '# Decisions', 'utf-8');
    await writeFile(join(memDir, 'notes.txt'), 'not markdown', 'utf-8');

    const files = await store.listMemoryFiles();
    expect(files).toContain('api-design.md');
    expect(files).toContain('decisions.md');
    expect(files).not.toContain('notes.txt');
    expect(files.length).toBe(2);
  });

  it('loadIdentity returns null when no identity file', async () => {
    const store = createStore();
    await store.ensureDirectories();
    const identity = await store.loadIdentity();
    expect(identity).toBeNull();
  });

  it('loadProject falls back to CLAUDE.md', async () => {
    const store = createStore();
    await store.ensureDirectories();

    await writeFile(join(tmpDir, 'CLAUDE.md'), '# Project Context from CLAUDE.md', 'utf-8');

    const project = await store.loadProject();
    expect(project).toContain('CLAUDE.md');
  });
});

describe('loadMemoryContext', () => {
  it('returns empty string when no memory files exist', async () => {
    const store = createStore();
    await store.ensureDirectories();

    const context = await loadMemoryContext(store);
    expect(context).toBe('');
  });

  it('includes Identity section when identity file exists', async () => {
    const store = createStore();
    await store.ensureDirectories();

    const globalDir = join(tmpDir, 'global');
    await mkdir(globalDir, { recursive: true });
    await writeFile(join(globalDir, 'identity.md'), 'I am a test agent.', 'utf-8');

    const context = await loadMemoryContext(store);
    expect(context).toContain('# Persistent Memory');
    expect(context).toContain('## Identity');
    expect(context).toContain('I am a test agent.');
  });

  it('includes Memory Files listing', async () => {
    const store = createStore();
    await store.ensureDirectories();

    const memDir = store.getMemoryPath();
    await writeFile(join(memDir, 'setup.md'), '# Setup Notes', 'utf-8');
    await writeFile(join(memDir, 'patterns.md'), '# Patterns', 'utf-8');

    const context = await loadMemoryContext(store);
    expect(context).toContain('## Memory Files');
    expect(context).toContain('setup.md');
    expect(context).toContain('patterns.md');
  });

  it('includes Current Context section', async () => {
    const store = createStore();
    await store.ensureDirectories();
    await store.saveContext('Working on integration tests.');

    const context = await loadMemoryContext(store);
    expect(context).toContain('## Current Context');
    expect(context).toContain('Working on integration tests.');
  });
});
