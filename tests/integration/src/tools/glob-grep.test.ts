import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { globTool, grepTool } from '@agntk/core/tools';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'agntk-globgrep-test-'));
  await mkdir(join(tmpDir, 'src'), { recursive: true });
  await mkdir(join(tmpDir, 'src/utils'), { recursive: true });
  await mkdir(join(tmpDir, 'node_modules/fake'), { recursive: true });
  await writeFile(join(tmpDir, 'src/index.ts'), 'export function main() { return 42; }', 'utf-8');
  await writeFile(
    join(tmpDir, 'src/utils/helper.ts'),
    'export function helper() { return "help"; }',
    'utf-8',
  );
  await writeFile(join(tmpDir, 'src/readme.md'), '# Title\nSome content here.', 'utf-8');
  await writeFile(join(tmpDir, 'node_modules/fake/index.js'), 'module.exports = {}', 'utf-8');
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function parse(result: string) {
  return JSON.parse(result) as Record<string, unknown>;
}

describe('glob tool', () => {
  it('finds files matching pattern', async () => {
    const result = parse(
      await globTool.execute!({ pattern: '**/*.ts', path: tmpDir }, {} as never),
    );
    expect(result.success).toBe(true);
    const files = result.files as string[];
    expect(files.length).toBe(2);
    expect(files.some((f: string) => f.includes('index.ts'))).toBe(true);
    expect(files.some((f: string) => f.includes('helper.ts'))).toBe(true);
  });

  it('excludes node_modules by default', async () => {
    const result = parse(
      await globTool.execute!({ pattern: '**/*.js', path: tmpDir }, {} as never),
    );
    expect(result.success).toBe(true);
    const files = (result.files ?? []) as string[];
    expect(files.every((f: string) => !f.includes('node_modules'))).toBe(true);
  });

  it('returns empty for no matches', async () => {
    const result = parse(
      await globTool.execute!({ pattern: '**/*.xyz', path: tmpDir }, {} as never),
    );
    expect(result.success).toBe(true);
    const count = result.count ?? (result.files as string[])?.length ?? 0;
    expect(count).toBe(0);
  });
});

describe('grep tool', () => {
  it('finds content in files', async () => {
    const result = parse(
      await grepTool.execute!({ pattern: 'function main', path: tmpDir }, {} as never),
    );
    expect(result.success).toBe(true);
    const matches = result.matches as Array<Record<string, unknown>>;
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches.some((m) => (m.file as string).includes('index.ts'))).toBe(true);
  });

  it('supports regex patterns', async () => {
    const result = parse(
      await grepTool.execute!({ pattern: 'return \\d+', path: tmpDir }, {} as never),
    );
    expect(result.success).toBe(true);
    const matches = result.matches as Array<Record<string, unknown>>;
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty for no matches', async () => {
    const result = parse(
      await grepTool.execute!({ pattern: 'zzz_nonexistent_zzz', path: tmpDir }, {} as never),
    );
    expect(result.success).toBe(true);
    const matches = result.matches as Array<Record<string, unknown>>;
    expect(matches.length).toBe(0);
  });

  it('respects file type filter', async () => {
    const result = parse(
      await grepTool.execute!({ pattern: 'content', path: tmpDir, include: '*.md' }, {} as never),
    );
    expect(result.success).toBe(true);
    const matches = result.matches as Array<Record<string, unknown>>;
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches.every((m) => (m.file as string).endsWith('.md'))).toBe(true);
  });
});
