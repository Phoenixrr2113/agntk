import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { wrapAllToolsWithWorkspace } from '../tools/workspace-middleware';

vi.mock('@agntk/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

let workspaceDir: string;

async function createTempWorkspace() {
  workspaceDir = await mkdtemp(join(tmpdir(), 'agntk-workspace-test-'));
}

function createTool(result: unknown) {
  return {
    description: 'test tool',
    execute: vi.fn().mockResolvedValue(result),
  };
}

function shortString(length: number): string {
  return 'a'.repeat(length);
}

function longString(length: number = 10000): string {
  const lines: string[] = [];
  while (lines.join('\n').length < length) {
    lines.push(
      'This is a line of tool output that contains search results and findings. '.repeat(3),
    );
  }
  return lines.join('\n').slice(0, length);
}

describe('wrapAllToolsWithWorkspace', () => {
  beforeEach(async () => {
    await createTempWorkspace();
  });

  afterEach(async () => {
    await rm(workspaceDir, { recursive: true, force: true });
  });

  describe('small results', () => {
    it('passes through results below the threshold', async () => {
      const tools = {
        search: createTool('small result'),
      };

      const wrapped = wrapAllToolsWithWorkspace(tools, {
        getWorkspacePath: () => workspaceDir,
        tokenThreshold: 2000,
      });

      const result = await wrapped.search.execute!({});
      expect(result).toBe('small result');
    });

    it('passes through results at exactly the threshold', async () => {
      const exactThreshold = shortString(8000);
      const tools = {
        search: createTool(exactThreshold),
      };

      const wrapped = wrapAllToolsWithWorkspace(tools, {
        getWorkspacePath: () => workspaceDir,
        tokenThreshold: 2000,
      });

      const result = await wrapped.search.execute!({});
      expect(result).toBe(exactThreshold);
    });
  });

  describe('large results', () => {
    it('offloads results above the threshold to workspace file', async () => {
      const largeResult = longString(10000);
      const tools = {
        web_search: createTool(largeResult),
      };

      const wrapped = wrapAllToolsWithWorkspace(tools, {
        getWorkspacePath: () => workspaceDir,
        tokenThreshold: 2000,
      });

      const result = await wrapped.web_search.execute!({});
      const parsed = JSON.parse(result as string);

      expect(parsed._workspaceOffloaded).toBe(true);
      expect(parsed.savedTo).toContain(workspaceDir);
      expect(parsed.savedTo).toContain('web_search-');
      expect(parsed.estimatedTokens).toBeGreaterThan(2000);
      expect(parsed.summary).toBeDefined();
      expect(parsed.hint).toContain('Full result');
    });

    it('writes the full result to the workspace file', async () => {
      const largeResult = longString(10000);
      const tools = {
        grep: createTool(largeResult),
      };

      const wrapped = wrapAllToolsWithWorkspace(tools, {
        getWorkspacePath: () => workspaceDir,
        tokenThreshold: 2000,
      });

      const result = await wrapped.grep.execute!({});
      const parsed = JSON.parse(result as string);

      const fileContent = await readFile(parsed.savedTo, 'utf-8');
      expect(fileContent).toBe(largeResult);
    });

    it('truncates summary to summaryMaxChars', async () => {
      const largeResult = longString(10000);
      const tools = {
        search: createTool(largeResult),
      };

      const wrapped = wrapAllToolsWithWorkspace(tools, {
        getWorkspacePath: () => workspaceDir,
        tokenThreshold: 2000,
        summaryMaxChars: 200,
      });

      const result = await wrapped.search.execute!({});
      const parsed = JSON.parse(result as string);

      expect(parsed.summary.length).toBeLessThan(300);
    });
  });

  describe('excluded tools', () => {
    it('does not wrap excluded tools', async () => {
      const largeResult = longString(10000);
      const tools = {
        plan: createTool(largeResult),
        deep_reasoning: createTool(largeResult),
        search: createTool(largeResult),
      };

      const wrapped = wrapAllToolsWithWorkspace(tools, {
        getWorkspacePath: () => workspaceDir,
        tokenThreshold: 2000,
      });

      const planResult = await wrapped.plan.execute!({});
      expect(planResult).toBe(largeResult);

      const reasonResult = await wrapped.deep_reasoning.execute!({});
      expect(reasonResult).toBe(largeResult);

      const searchResult = await wrapped.search.execute!({});
      const parsed = JSON.parse(searchResult as string);
      expect(parsed._workspaceOffloaded).toBe(true);
    });

    it('accepts custom exclude list', async () => {
      const largeResult = longString(10000);
      const tools = {
        my_tool: createTool(largeResult),
        other_tool: createTool(largeResult),
      };

      const wrapped = wrapAllToolsWithWorkspace(tools, {
        getWorkspacePath: () => workspaceDir,
        tokenThreshold: 2000,
        excludeTools: ['my_tool'],
      });

      const myResult = await wrapped.my_tool.execute!({});
      expect(myResult).toBe(largeResult);

      const otherResult = await wrapped.other_tool.execute!({});
      const parsed = JSON.parse(otherResult as string);
      expect(parsed._workspaceOffloaded).toBe(true);
    });
  });

  describe('workspace path resolution', () => {
    it('passes through when getWorkspacePath returns null', async () => {
      const largeResult = longString(10000);
      const tools = {
        search: createTool(largeResult),
      };

      const wrapped = wrapAllToolsWithWorkspace(tools, {
        getWorkspacePath: () => null,
        tokenThreshold: 2000,
      });

      const result = await wrapped.search.execute!({});
      expect(result).toBe(largeResult);
    });

    it('resolves workspace path lazily per call', async () => {
      const largeResult = longString(10000);
      let currentPath: string | null = null;
      const tools = {
        search: createTool(largeResult),
      };

      const wrapped = wrapAllToolsWithWorkspace(tools, {
        getWorkspacePath: () => currentPath,
        tokenThreshold: 2000,
      });

      const result1 = await wrapped.search.execute!({});
      expect(result1).toBe(largeResult);

      currentPath = workspaceDir;
      const result2 = await wrapped.search.execute!({});
      const parsed = JSON.parse(result2 as string);
      expect(parsed._workspaceOffloaded).toBe(true);
    });
  });

  describe('non-string results', () => {
    it('passes through object results unchanged', async () => {
      const objectResult = { success: true, data: [1, 2, 3] };
      const tools = {
        api_call: createTool(objectResult),
      };

      const wrapped = wrapAllToolsWithWorkspace(tools, {
        getWorkspacePath: () => workspaceDir,
        tokenThreshold: 2000,
      });

      const result = await wrapped.api_call.execute!({});
      expect(result).toEqual(objectResult);
    });

    it('passes through numeric results unchanged', async () => {
      const tools = {
        count: createTool(42),
      };

      const wrapped = wrapAllToolsWithWorkspace(tools, {
        getWorkspacePath: () => workspaceDir,
        tokenThreshold: 2000,
      });

      const result = await wrapped.count.execute!({});
      expect(result).toBe(42);
    });
  });

  describe('tools without execute', () => {
    it('passes through tools without execute function', () => {
      const tools = {
        no_exec: { description: 'no execute' },
      };

      const wrapped = wrapAllToolsWithWorkspace(tools, {
        getWorkspacePath: () => workspaceDir,
      });

      expect(wrapped.no_exec.execute).toBeUndefined();
    });
  });

  describe('workspace subdirectory creation', () => {
    it('creates subdirectory if workspace path does not exist', async () => {
      const nestedPath = join(workspaceDir, 'task-folder', 'lead');
      const largeResult = longString(10000);
      const tools = {
        search: createTool(largeResult),
      };

      const wrapped = wrapAllToolsWithWorkspace(tools, {
        getWorkspacePath: () => nestedPath,
        tokenThreshold: 2000,
      });

      const result = await wrapped.search.execute!({});
      const parsed = JSON.parse(result as string);
      expect(existsSync(parsed.savedTo)).toBe(true);
    });
  });
});
