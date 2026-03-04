import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFileTools } from '@agntk/core/tools';

let tmpDir: string;
let outsideDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'agntk-file-test-'));
  outsideDir = await mkdtemp(join(tmpdir(), 'agntk-outside-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  await rm(outsideDir, { recursive: true, force: true });
});

function parse(result: string) {
  return JSON.parse(result) as Record<string, unknown>;
}

describe('file_write', () => {
  it('creates file in workspace root', async () => {
    const tools = createFileTools(tmpDir);
    const result = parse(
      await tools.file_write.execute({ path: 'test.txt', content: 'hello' }, {} as never),
    );
    expect(result.success).toBe(true);
    expect(await readFile(join(tmpDir, 'test.txt'), 'utf-8')).toBe('hello');
  });

  it('creates nested directories that do not exist (Bug #1 regression)', async () => {
    const tools = createFileTools(tmpDir);
    const result = parse(
      await tools.file_write.execute({ path: 'a/b/c/deep.txt', content: 'nested' }, {} as never),
    );
    expect(result.success).toBe(true);
    expect(existsSync(join(tmpDir, 'a/b/c/deep.txt'))).toBe(true);
    expect(await readFile(join(tmpDir, 'a/b/c/deep.txt'), 'utf-8')).toBe('nested');
  });

  it('overwrites existing file', async () => {
    await writeFile(join(tmpDir, 'existing.txt'), 'old', 'utf-8');
    const tools = createFileTools(tmpDir);
    await tools.file_write.execute({ path: 'existing.txt', content: 'new' }, {} as never);
    expect(await readFile(join(tmpDir, 'existing.txt'), 'utf-8')).toBe('new');
  });

  it('blocks path outside workspace', async () => {
    const tools = createFileTools(tmpDir);
    const result = parse(
      await tools.file_write.execute(
        { path: join(outsideDir, 'evil.txt'), content: 'hack' },
        {} as never,
      ),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('outside workspace');
  });

  it('allows path in allowedPaths outside workspace (Bug #2 regression)', async () => {
    const tools = createFileTools(tmpDir, { allowedPaths: [outsideDir] });
    const result = parse(
      await tools.file_write.execute(
        { path: join(outsideDir, 'allowed.txt'), content: 'ok' },
        {} as never,
      ),
    );
    expect(result.success).toBe(true);
    expect(await readFile(join(outsideDir, 'allowed.txt'), 'utf-8')).toBe('ok');
  });

  it('blocks null bytes in path', async () => {
    const tools = createFileTools(tmpDir);
    const result = parse(
      await tools.file_write.execute({ path: 'bad\0file.txt', content: 'x' }, {} as never),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('Null bytes');
  });
});

describe('file_read', () => {
  it('reads existing file with line numbers', async () => {
    await writeFile(join(tmpDir, 'read-me.txt'), 'line1\nline2\nline3', 'utf-8');
    const tools = createFileTools(tmpDir);
    const result = parse(await tools.file_read.execute({ path: 'read-me.txt' }, {} as never));
    expect(result.success).toBe(true);
    expect(result.totalLines).toBe(3);
    expect(result.content).toContain('line1');
    expect(result.content).toContain('line3');
  });

  it('reads specific line range', async () => {
    await writeFile(join(tmpDir, 'lines.txt'), 'a\nb\nc\nd\ne', 'utf-8');
    const tools = createFileTools(tmpDir);
    const result = parse(
      await tools.file_read.execute({ path: 'lines.txt', startLine: 2, endLine: 4 }, {} as never),
    );
    expect(result.success).toBe(true);
    const content = result.content as string;
    expect(content).toContain('b');
    expect(content).toContain('d');
    expect(content).not.toContain('a');
    expect(content).not.toContain('e');
  });

  it('returns error for nonexistent file', async () => {
    const tools = createFileTools(tmpDir);
    const result = parse(await tools.file_read.execute({ path: 'nope.txt' }, {} as never));
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('blocks path outside workspace', async () => {
    await writeFile(join(outsideDir, 'secret.txt'), 'secret', 'utf-8');
    const tools = createFileTools(tmpDir);
    const result = parse(
      await tools.file_read.execute({ path: join(outsideDir, 'secret.txt') }, {} as never),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('outside workspace');
  });

  it('blocks sensitive paths (.env)', async () => {
    await writeFile(join(tmpDir, '.env'), 'SECRET=123', 'utf-8');
    const tools = createFileTools(tmpDir);
    const result = parse(await tools.file_read.execute({ path: '.env' }, {} as never));
    expect(result.success).toBe(false);
    expect(result.error).toContain('sensitive');
  });
});

describe('file_edit', () => {
  it('replaces text in file', async () => {
    await writeFile(join(tmpDir, 'edit-me.txt'), 'hello world', 'utf-8');
    const tools = createFileTools(tmpDir);
    const result = parse(
      await tools.file_edit.execute(
        { path: 'edit-me.txt', oldText: 'world', newText: 'earth' },
        {} as never,
      ),
    );
    expect(result.success).toBe(true);
    expect(await readFile(join(tmpDir, 'edit-me.txt'), 'utf-8')).toBe('hello earth');
  });

  it('rejects when oldText not found', async () => {
    await writeFile(join(tmpDir, 'edit-me.txt'), 'hello world', 'utf-8');
    const tools = createFileTools(tmpDir);
    const result = parse(
      await tools.file_edit.execute(
        { path: 'edit-me.txt', oldText: 'missing', newText: 'x' },
        {} as never,
      ),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('rejects when multiple matches', async () => {
    await writeFile(join(tmpDir, 'edit-me.txt'), 'aaa bbb aaa', 'utf-8');
    const tools = createFileTools(tmpDir);
    const result = parse(
      await tools.file_edit.execute(
        { path: 'edit-me.txt', oldText: 'aaa', newText: 'x' },
        {} as never,
      ),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('matches');
  });

  it('returns error for nonexistent file', async () => {
    const tools = createFileTools(tmpDir);
    const result = parse(
      await tools.file_edit.execute({ path: 'nope.txt', oldText: 'a', newText: 'b' }, {} as never),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });
});

describe('file_create', () => {
  it('creates new file', async () => {
    const tools = createFileTools(tmpDir);
    const result = parse(
      await tools.file_create.execute({ path: 'new.txt', content: 'brand new' }, {} as never),
    );
    expect(result.success).toBe(true);
    expect(await readFile(join(tmpDir, 'new.txt'), 'utf-8')).toBe('brand new');
  });

  it('creates nested directories', async () => {
    const tools = createFileTools(tmpDir);
    const result = parse(
      await tools.file_create.execute({ path: 'x/y/z/new.txt', content: 'deep' }, {} as never),
    );
    expect(result.success).toBe(true);
    expect(existsSync(join(tmpDir, 'x/y/z/new.txt'))).toBe(true);
  });

  it('fails on existing file', async () => {
    await writeFile(join(tmpDir, 'exists.txt'), 'old', 'utf-8');
    const tools = createFileTools(tmpDir);
    const result = parse(
      await tools.file_create.execute({ path: 'exists.txt', content: 'new' }, {} as never),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('already exists');
    expect(await readFile(join(tmpDir, 'exists.txt'), 'utf-8')).toBe('old');
  });
});

describe('symlink handling', () => {
  it('reads through symlink within workspace', async () => {
    await writeFile(join(tmpDir, 'real.txt'), 'real content', 'utf-8');
    await symlink(join(tmpDir, 'real.txt'), join(tmpDir, 'link.txt'));
    const tools = createFileTools(tmpDir);
    const result = parse(await tools.file_read.execute({ path: 'link.txt' }, {} as never));
    expect(result.success).toBe(true);
    expect(result.content).toContain('real content');
  });

  it('blocks symlink that escapes workspace', async () => {
    await writeFile(join(outsideDir, 'escape.txt'), 'escaped', 'utf-8');
    await symlink(join(outsideDir, 'escape.txt'), join(tmpDir, 'escape-link.txt'));
    const tools = createFileTools(tmpDir);
    const result = parse(await tools.file_read.execute({ path: 'escape-link.txt' }, {} as never));
    expect(result.success).toBe(false);
    expect(result.error).toContain('outside workspace');
  });
});
