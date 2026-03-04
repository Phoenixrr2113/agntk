import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MarkdownMemoryStore, loadMemoryContext, createAgent } from '@agntk/core';
import { createSearchSkillsTool, clearSkillsCache } from '@agntk/core/advanced';

let workspaceDir: string;
let globalDir: string;

async function createTempDirs() {
  workspaceDir = await mkdtemp(join(tmpdir(), 'agntk-integration-'));
  globalDir = await mkdtemp(join(tmpdir(), 'agntk-integration-global-'));
}

describe('Memory', () => {
  beforeEach(async () => {
    await createTempDirs();
  });

  afterEach(async () => {
    await rm(workspaceDir, { recursive: true, force: true });
    await rm(globalDir, { recursive: true, force: true });
  });

  describe('MarkdownMemoryStore lifecycle', () => {
    it('should handle project fallback to CLAUDE.md', async () => {
      await writeFile(join(workspaceDir, 'CLAUDE.md'), '# Claude Config\nUse strict mode', 'utf-8');

      const store = new MarkdownMemoryStore({
        workspaceRoot: workspaceDir,
        globalDir: join(globalDir, '.agntk'),
      });

      const project = await store.loadProject();
      expect(project).toContain('Use strict mode');
    });

    it('should append decisions', async () => {
      const store = new MarkdownMemoryStore({
        workspaceRoot: workspaceDir,
        globalDir: join(globalDir, '.agntk'),
      });

      await store.appendDecision('## Decision 1');
      await store.appendDecision('## Decision 2');

      const decisions = await store.loadDecisions();
      expect(decisions).toContain('Decision 1');
      expect(decisions).toContain('Decision 2');
    });

    it('should save and load context', async () => {
      const store = new MarkdownMemoryStore({
        workspaceRoot: workspaceDir,
        globalDir: join(globalDir, '.agntk'),
      });

      await store.saveContext('Working on integration tests');
      const context = await store.loadContext();
      expect(context).toContain('Working on integration tests');
    });
  });

  describe('loadMemoryContext', () => {
    it('should return empty string when no files exist', async () => {
      const store = new MarkdownMemoryStore({
        workspaceRoot: workspaceDir,
        globalDir: join(globalDir, '.agntk'),
      });

      const result = await loadMemoryContext(store);
      expect(result).toBe('');
    });

    it('should format loaded files into sections', async () => {
      const store = new MarkdownMemoryStore({
        workspaceRoot: workspaceDir,
        globalDir: join(globalDir, '.agntk'),
      });

      await store.saveContext('Working on tests');

      const result = await loadMemoryContext(store);
      expect(result).toContain('# Persistent Memory');
      expect(result).toContain('## Current Context');
    });
  });

  describe('createAgent (workspace-based)', () => {
    it('should create agent with task-based tools', () => {
      const agent = createAgent({
        name: 'workspace-test-agent',
        workspaceRoot: workspaceDir,
      });

      expect(agent).toBeDefined();
      expect(agent.name).toBe('workspace-test-agent');
      expect(typeof agent.init).toBe('function');
      expect(typeof agent.stream).toBe('function');

      const toolNames = agent.getToolNames();
      expect(toolNames).toContain('spawn_agent');
      expect(toolNames).toContain('check_agent');

      expect(toolNames).not.toContain('remember');
      expect(toolNames).not.toContain('recall');
      expect(toolNames).not.toContain('forget');
      expect(toolNames).not.toContain('update_context');
    });

    it('should have init method that resolves', async () => {
      const agent = createAgent({
        name: 'workspace-init-agent',
        workspaceRoot: workspaceDir,
      });

      await expect(agent.init()).resolves.toBeUndefined();
    });
  });

  describe('createSearchSkillsTool', () => {
    it('should create a tool object', () => {
      const tool = createSearchSkillsTool({
        workspaceRoot: process.cwd(),
      });

      expect(tool).toBeDefined();
    });

    it('should clear skills cache without error', () => {
      expect(() => clearSkillsCache()).not.toThrow();
    });
  });
});
