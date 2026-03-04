import { describe, it, expect, vi } from 'vitest';

vi.mock('@agntk/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    time: vi.fn(() => vi.fn()),
  }),
}));

import { loadMemoryContext } from '../memory/loader';
import type { MemoryStore } from '../memory/types';

function createMockStore(overrides: Partial<MemoryStore> = {}): MemoryStore {
  return {
    loadIdentity: vi.fn().mockResolvedValue(null),
    loadPreferences: vi.fn().mockResolvedValue(null),
    loadProject: vi.fn().mockResolvedValue(null),
    loadContext: vi.fn().mockResolvedValue(null),
    loadDecisions: vi.fn().mockResolvedValue(null),
    saveContext: vi.fn().mockResolvedValue(undefined),
    savePreferences: vi.fn().mockResolvedValue(undefined),
    appendDecision: vi.fn().mockResolvedValue(undefined),
    listMemoryFiles: vi.fn().mockResolvedValue([]),
    createTaskFolder: vi.fn().mockResolvedValue('/tmp/task'),
    archiveTask: vi.fn().mockResolvedValue(undefined),
    getCurrentTaskPath: vi.fn().mockResolvedValue(null),
    getProjectPath: vi.fn().mockReturnValue('/tmp/.agntk'),
    getGlobalPath: vi.fn().mockReturnValue('/home/.agntk'),
    getMemoryPath: vi.fn().mockReturnValue('/tmp/.agntk/memory'),
    getWorkspacePath: vi.fn().mockReturnValue('/tmp/.agntk/workspace'),
    getArchivePath: vi.fn().mockReturnValue('/tmp/.agntk/archive'),
    ensureDirectories: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('loadMemoryContext', () => {
  describe('empty state', () => {
    it('returns empty string when no files exist', async () => {
      const store = createMockStore();
      const result = await loadMemoryContext(store);
      expect(result).toBe('');
    });
  });

  describe('single file loading', () => {
    it('loads identity as Identity section', async () => {
      const store = createMockStore({
        loadIdentity: vi.fn().mockResolvedValue('I am a helpful assistant'),
      });
      const result = await loadMemoryContext(store);
      expect(result).toContain('# Persistent Memory');
      expect(result).toContain('## Identity');
      expect(result).toContain('I am a helpful assistant');
    });

    it('loads preferences as Preferences section', async () => {
      const store = createMockStore({
        loadPreferences: vi.fn().mockResolvedValue('Use Vitest for testing'),
      });
      const result = await loadMemoryContext(store);
      expect(result).toContain('## Preferences');
      expect(result).toContain('Use Vitest for testing');
    });

    it('loads project as Project section', async () => {
      const store = createMockStore({
        loadProject: vi.fn().mockResolvedValue('# My Project\nA TypeScript project'),
      });
      const result = await loadMemoryContext(store);
      expect(result).toContain('## Project');
      expect(result).toContain('A TypeScript project');
    });

    it('loads context as Current Context section', async () => {
      const store = createMockStore({
        loadContext: vi.fn().mockResolvedValue('Working on Phase 2 memory system'),
      });
      const result = await loadMemoryContext(store);
      expect(result).toContain('## Current Context');
      expect(result).toContain('Working on Phase 2 memory system');
    });
  });

  describe('memory file listing', () => {
    it('lists memory files when present', async () => {
      const store = createMockStore({
        listMemoryFiles: vi
          .fn()
          .mockResolvedValue(['api-design.md', 'decisions.md', 'project-setup.md']),
      });
      const result = await loadMemoryContext(store);
      expect(result).toContain('## Memory Files');
      expect(result).toContain('- api-design.md');
      expect(result).toContain('- decisions.md');
      expect(result).toContain('- project-setup.md');
    });

    it('does not include memory files section when empty', async () => {
      const store = createMockStore({
        listMemoryFiles: vi.fn().mockResolvedValue([]),
        loadProject: vi.fn().mockResolvedValue('project content'),
      });
      const result = await loadMemoryContext(store);
      expect(result).not.toContain('## Memory Files');
    });
  });

  describe('load order', () => {
    it('sections appear in correct order: Identity, Preferences, Project, Memory Files, Context', async () => {
      const store = createMockStore({
        loadIdentity: vi.fn().mockResolvedValue('identity-content'),
        loadPreferences: vi.fn().mockResolvedValue('preferences-content'),
        loadProject: vi.fn().mockResolvedValue('project-content'),
        listMemoryFiles: vi.fn().mockResolvedValue(['notes.md']),
        loadContext: vi.fn().mockResolvedValue('context-content'),
      });

      const result = await loadMemoryContext(store);

      const identityIdx = result.indexOf('## Identity');
      const preferencesIdx = result.indexOf('## Preferences');
      const projectIdx = result.indexOf('## Project');
      const memoryIdx = result.indexOf('## Memory Files');
      const contextIdx = result.indexOf('## Current Context');

      expect(identityIdx).toBeLessThan(preferencesIdx);
      expect(preferencesIdx).toBeLessThan(projectIdx);
      expect(projectIdx).toBeLessThan(memoryIdx);
      expect(memoryIdx).toBeLessThan(contextIdx);
    });
  });

  describe('missing files', () => {
    it('skips missing files without error', async () => {
      const store = createMockStore({
        loadIdentity: vi.fn().mockResolvedValue(null),
        loadProject: vi.fn().mockResolvedValue('project content'),
        listMemoryFiles: vi.fn().mockResolvedValue([]),
      });

      const result = await loadMemoryContext(store);
      expect(result).toContain('## Project');
      expect(result).not.toContain('## Identity');
      expect(result).not.toContain('## Memory Files');
    });
  });

  describe('formatting', () => {
    it('starts with # Persistent Memory header', async () => {
      const store = createMockStore({
        loadProject: vi.fn().mockResolvedValue('some project'),
      });
      const result = await loadMemoryContext(store);
      expect(result.startsWith('# Persistent Memory')).toBe(true);
    });

    it('separates sections with double newlines', async () => {
      const store = createMockStore({
        loadIdentity: vi.fn().mockResolvedValue('identity'),
        loadProject: vi.fn().mockResolvedValue('project'),
      });
      const result = await loadMemoryContext(store);
      expect(result).toContain('\n\n## Project');
    });
  });
});
