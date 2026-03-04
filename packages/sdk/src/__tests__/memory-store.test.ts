import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MarkdownMemoryStore } from '../memory/store';

let projectDir: string;
let globalDir: string;

async function createTempDirs() {
  projectDir = await mkdtemp(join(tmpdir(), 'agntk-test-project-'));
  globalDir = await mkdtemp(join(tmpdir(), 'agntk-test-global-'));
}

function createStore(opts?: { projectDir?: string; globalDir?: string; workspaceRoot?: string }) {
  return new MarkdownMemoryStore({
    projectDir: opts?.projectDir ?? '.agntk',
    globalDir: opts?.globalDir ?? join(globalDir, '.agntk'),
    workspaceRoot: opts?.workspaceRoot ?? projectDir,
  });
}

describe('MarkdownMemoryStore', () => {
  beforeEach(async () => {
    await createTempDirs();
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
    await rm(globalDir, { recursive: true, force: true });
  });

  describe('load methods (missing files)', () => {
    it('loadIdentity returns null when file does not exist', async () => {
      const store = createStore();
      expect(await store.loadIdentity()).toBeNull();
    });

    it('loadPreferences returns null when file does not exist', async () => {
      const store = createStore();
      expect(await store.loadPreferences()).toBeNull();
    });

    it('loadProject returns null when no project files exist', async () => {
      const store = createStore();
      expect(await store.loadProject()).toBeNull();
    });

    it('loadContext returns null when file does not exist', async () => {
      const store = createStore();
      expect(await store.loadContext()).toBeNull();
    });

    it('loadDecisions returns null when file does not exist', async () => {
      const store = createStore();
      expect(await store.loadDecisions()).toBeNull();
    });
  });

  describe('save and load', () => {
    it('saveContext creates directory and writes file, loadContext reads it back', async () => {
      const store = createStore();
      await store.saveContext('# Current Context\nWorking on tests');
      const result = await store.loadContext();
      expect(result).toBe('# Current Context\nWorking on tests');
    });

    it('savePreferences writes to global directory', async () => {
      const store = createStore();
      await store.savePreferences('# Preferences\n- Use Vitest');
      const result = await store.loadPreferences();
      expect(result).toBe('# Preferences\n- Use Vitest');
    });

    it('returns null for empty files', async () => {
      const store = createStore();
      const agntDir = join(projectDir, '.agntk');
      await mkdir(agntDir, { recursive: true });
      await writeFile(join(agntDir, 'context.md'), '', 'utf-8');
      expect(await store.loadContext()).toBeNull();
    });

    it('returns null for whitespace-only files', async () => {
      const store = createStore();
      const agntDir = join(projectDir, '.agntk');
      await mkdir(agntDir, { recursive: true });
      await writeFile(join(agntDir, 'context.md'), '   \n  \n', 'utf-8');
      expect(await store.loadContext()).toBeNull();
    });
  });

  describe('auto-directory creation', () => {
    it('creates .agntk/ directory on first save', async () => {
      const store = createStore();
      const agntDir = join(projectDir, '.agntk');
      expect(existsSync(agntDir)).toBe(false);
      await store.saveContext('test content');
      expect(existsSync(agntDir)).toBe(true);
    });

    it('creates global directory on first savePreferences', async () => {
      const globalAgntDir = join(globalDir, '.agntk');
      const store = createStore();
      expect(existsSync(globalAgntDir)).toBe(false);
      await store.savePreferences('test prefs');
      expect(existsSync(globalAgntDir)).toBe(true);
    });
  });

  describe('loadProject fallback', () => {
    it('returns .agntk/project.md if it exists', async () => {
      const store = createStore();
      const agntDir = join(projectDir, '.agntk');
      await mkdir(agntDir, { recursive: true });
      await writeFile(join(agntDir, 'project.md'), '# Project\nMy project', 'utf-8');
      expect(await store.loadProject()).toBe('# Project\nMy project');
    });

    it('falls back to CLAUDE.md in workspace root', async () => {
      const store = createStore();
      await writeFile(join(projectDir, 'CLAUDE.md'), '# Claude Config', 'utf-8');
      expect(await store.loadProject()).toBe('# Claude Config');
    });

    it('falls back to AGENTS.md if CLAUDE.md does not exist', async () => {
      const store = createStore();
      await writeFile(join(projectDir, 'AGENTS.md'), '# Agents Config', 'utf-8');
      expect(await store.loadProject()).toBe('# Agents Config');
    });

    it('prefers .agntk/project.md over CLAUDE.md', async () => {
      const store = createStore();
      const agntDir = join(projectDir, '.agntk');
      await mkdir(agntDir, { recursive: true });
      await writeFile(join(agntDir, 'project.md'), 'project.md content', 'utf-8');
      await writeFile(join(projectDir, 'CLAUDE.md'), 'claude.md content', 'utf-8');
      expect(await store.loadProject()).toBe('project.md content');
    });

    it('prefers CLAUDE.md over AGENTS.md', async () => {
      const store = createStore();
      await writeFile(join(projectDir, 'CLAUDE.md'), 'claude content', 'utf-8');
      await writeFile(join(projectDir, 'AGENTS.md'), 'agents content', 'utf-8');
      expect(await store.loadProject()).toBe('claude content');
    });
  });

  describe('appendDecision', () => {
    it('creates file with entry if file does not exist', async () => {
      const store = createStore();
      await store.appendDecision('## 2025-01-01 — Use Vitest');
      const result = await store.loadDecisions();
      expect(result).toBe('## 2025-01-01 — Use Vitest');
    });

    it('appends with separator if file already exists', async () => {
      const store = createStore();
      await store.appendDecision('## First decision');
      await store.appendDecision('## Second decision');
      const result = await store.loadDecisions();
      expect(result).toContain('## First decision');
      expect(result).toContain('## Second decision');
      expect(result).toContain('\n\n');
    });

    it('writes to memory/ subdirectory', async () => {
      const store = createStore();
      await store.appendDecision('## Decision');
      const memoryDir = store.getMemoryPath();
      expect(existsSync(join(memoryDir, 'decisions.md'))).toBe(true);
    });
  });

  describe('path getters', () => {
    it('getProjectPath returns resolved path', () => {
      const store = createStore();
      expect(store.getProjectPath()).toContain('.agntk');
    });

    it('getGlobalPath returns resolved path', () => {
      const store = createStore();
      expect(store.getGlobalPath()).toContain('.agntk');
    });

    it('getMemoryPath returns memory/ subdirectory', () => {
      const store = createStore();
      expect(store.getMemoryPath()).toContain('memory');
      expect(store.getMemoryPath()).toContain('.agntk');
    });

    it('getWorkspacePath returns workspace/ subdirectory', () => {
      const store = createStore();
      expect(store.getWorkspacePath()).toContain('workspace');
    });

    it('getArchivePath returns archive/ subdirectory', () => {
      const store = createStore();
      expect(store.getArchivePath()).toContain('archive');
    });
  });

  describe('ensureDirectories', () => {
    it('creates memory/, workspace/, archive/ directories', async () => {
      const store = createStore();
      await store.ensureDirectories();
      expect(existsSync(store.getMemoryPath())).toBe(true);
      expect(existsSync(store.getWorkspacePath())).toBe(true);
      expect(existsSync(store.getArchivePath())).toBe(true);
    });

    it('is idempotent', async () => {
      const store = createStore();
      await store.ensureDirectories();
      await store.ensureDirectories();
      expect(existsSync(store.getMemoryPath())).toBe(true);
    });
  });

  describe('listMemoryFiles', () => {
    it('returns empty array when memory/ does not exist', async () => {
      const store = createStore();
      expect(await store.listMemoryFiles()).toEqual([]);
    });

    it('returns .md files from memory/ directory', async () => {
      const store = createStore();
      const memoryDir = store.getMemoryPath();
      await mkdir(memoryDir, { recursive: true });
      await writeFile(join(memoryDir, 'api-design.md'), 'api notes', 'utf-8');
      await writeFile(join(memoryDir, 'decisions.md'), 'decisions log', 'utf-8');
      await writeFile(join(memoryDir, 'project-setup.md'), 'setup notes', 'utf-8');

      const files = await store.listMemoryFiles();
      expect(files).toEqual(['api-design.md', 'decisions.md', 'project-setup.md']);
    });

    it('excludes non-.md files', async () => {
      const store = createStore();
      const memoryDir = store.getMemoryPath();
      await mkdir(memoryDir, { recursive: true });
      await writeFile(join(memoryDir, 'notes.md'), 'notes', 'utf-8');
      await writeFile(join(memoryDir, 'data.json'), '{}', 'utf-8');
      await writeFile(join(memoryDir, '.hidden'), 'secret', 'utf-8');

      const files = await store.listMemoryFiles();
      expect(files).toEqual(['notes.md']);
    });

    it('returns sorted filenames', async () => {
      const store = createStore();
      const memoryDir = store.getMemoryPath();
      await mkdir(memoryDir, { recursive: true });
      await writeFile(join(memoryDir, 'zebra.md'), 'z', 'utf-8');
      await writeFile(join(memoryDir, 'alpha.md'), 'a', 'utf-8');
      await writeFile(join(memoryDir, 'middle.md'), 'm', 'utf-8');

      const files = await store.listMemoryFiles();
      expect(files).toEqual(['alpha.md', 'middle.md', 'zebra.md']);
    });
  });

  describe('createTaskFolder', () => {
    it('creates a timestamped folder in workspace/', async () => {
      const store = createStore();
      const path = await store.createTaskFolder('research-db');

      expect(existsSync(path)).toBe(true);
      expect(path).toContain('workspace');
      expect(path).toContain('research-db');
    });

    it('sanitizes label characters', async () => {
      const store = createStore();
      const path = await store.createTaskFolder('Research DB Analytics!');

      expect(path).toContain('research-db-analytics-');
      expect(existsSync(path)).toBe(true);
    });

    it('creates current symlink pointing to new folder', async () => {
      const store = createStore();
      const path = await store.createTaskFolder('my-task');

      const currentPath = await store.getCurrentTaskPath();
      expect(currentPath).toBe(path);
    });

    it('updates current symlink when creating a second task', async () => {
      const store = createStore();
      await store.createTaskFolder('first-task');
      const secondPath = await store.createTaskFolder('second-task');

      const currentPath = await store.getCurrentTaskPath();
      expect(currentPath).toBe(secondPath);
    });
  });

  describe('archiveTask', () => {
    it('moves task folder from workspace/ to archive/', async () => {
      const store = createStore();
      const taskPath = await store.createTaskFolder('done-task');
      const folderName = taskPath.split('/').pop()!;

      await store.archiveTask(folderName);

      expect(existsSync(taskPath)).toBe(false);
      expect(existsSync(join(store.getArchivePath(), folderName))).toBe(true);
    });

    it('does not throw for non-existent folder', async () => {
      const store = createStore();
      await store.ensureDirectories();
      await expect(store.archiveTask('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('getCurrentTaskPath', () => {
    it('returns null when no current symlink exists', async () => {
      const store = createStore();
      await store.ensureDirectories();
      expect(await store.getCurrentTaskPath()).toBeNull();
    });

    it('returns the target of the current symlink', async () => {
      const store = createStore();
      const path = await store.createTaskFolder('active-task');
      expect(await store.getCurrentTaskPath()).toBe(path);
    });
  });
});
