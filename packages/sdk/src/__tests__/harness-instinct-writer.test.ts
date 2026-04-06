import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createInstinctTool } from '../harness/instinct-writer';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'instinct-writer-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('createInstinctTool', () => {
  it('creates an instinct file with correct frontmatter', async () => {
    const instinctTool = createInstinctTool({ harnessRoot: tmpDir });
    const execute = instinctTool.execute as (params: {
      text: string;
      tags: string[];
      source: string;
    }) => Promise<string>;

    const result = await execute({
      text: 'When API calls fail with 429, implement exponential backoff starting at 1s.',
      tags: ['error-handling', 'api', 'rate-limiting'],
      source: 'session-2025-01-15-abc',
    });

    const parsed = JSON.parse(result) as {
      success: boolean;
      path: string;
      id: string;
    };
    expect(parsed.success).toBe(true);
    expect(parsed.id).toMatch(/^instinct-/);
    expect(parsed.path).toBeDefined();

    const content = fs.readFileSync(parsed.path, 'utf-8');
    expect(content).toContain('author: agent');
    expect(content).toContain('status: draft');
    expect(content).toContain('source: session-2025-01-15-abc');
    expect(content).toContain('tags: [error-handling, api, rate-limiting]');
    expect(content).toContain('<!-- L0:');
    expect(content).toContain('<!-- L1:');
    expect(content).toContain('exponential backoff');
  });

  it('creates the instincts directory if it does not exist', async () => {
    const harnessRoot = path.join(tmpDir, 'nested', 'harness');
    const instinctTool = createInstinctTool({ harnessRoot });
    const execute = instinctTool.execute as (params: {
      text: string;
      tags: string[];
      source: string;
    }) => Promise<string>;

    const result = await execute({
      text: 'Test instinct.',
      tags: ['test'],
      source: 'test-session',
    });

    const parsed = JSON.parse(result) as { success: boolean };
    expect(parsed.success).toBe(true);
    expect(fs.existsSync(path.join(harnessRoot, 'instincts'))).toBe(true);
  });

  it('generates unique IDs for each instinct', async () => {
    const instinctTool = createInstinctTool({ harnessRoot: tmpDir });
    const execute = instinctTool.execute as (params: {
      text: string;
      tags: string[];
      source: string;
    }) => Promise<string>;

    const result1 = JSON.parse(
      await execute({ text: 'First instinct.', tags: ['a'], source: 's1' }),
    ) as { id: string };
    const result2 = JSON.parse(
      await execute({ text: 'Second instinct.', tags: ['b'], source: 's2' }),
    ) as { id: string };

    expect(result1.id).not.toBe(result2.id);
  });

  it('truncates long L0 to 80 characters', async () => {
    const instinctTool = createInstinctTool({ harnessRoot: tmpDir });
    const execute = instinctTool.execute as (params: {
      text: string;
      tags: string[];
      source: string;
    }) => Promise<string>;

    const longText =
      'This is a very long first sentence that exceeds eighty characters and should be truncated in the L0 comment. More content follows.';

    const result = JSON.parse(
      await execute({ text: longText, tags: ['test'], source: 'test' }),
    ) as { path: string };

    const content = fs.readFileSync(result.path, 'utf-8');
    const l0Match = content.match(/<!-- L0: (.+?) -->/);
    expect(l0Match).not.toBeNull();
    expect(l0Match![1].length).toBeLessThanOrEqual(80);
    expect(l0Match![1]).toContain('...');
  });
});
