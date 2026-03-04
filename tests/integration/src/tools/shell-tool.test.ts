import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createShellTool, createBackgroundTool } from '@agntk/core/tools';
import { clearBackgroundSessions } from '@agntk/core/tools';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'agntk-shell-test-'));
  clearBackgroundSessions();
});

afterEach(async () => {
  clearBackgroundSessions();
  await rm(tmpDir, { recursive: true, force: true });
});

function parse(result: string) {
  return JSON.parse(result) as Record<string, unknown>;
}

describe('shell tool', () => {
  it('captures stdout from echo', async () => {
    const shell = createShellTool(tmpDir);
    const result = parse(await shell.execute!({ command: 'echo hello-shell' }, {} as never));
    expect(result.success).toBe(true);
    expect(result.stdout).toContain('hello-shell');
    expect(result.exitCode).toBe(0);
    expect(result.status).toBe('success');
  });

  it('captures stdout from ls on known directory', async () => {
    await writeFile(join(tmpDir, 'a.txt'), 'a', 'utf-8');
    await writeFile(join(tmpDir, 'b.txt'), 'b', 'utf-8');
    const shell = createShellTool(tmpDir);
    const result = parse(await shell.execute!({ command: 'ls' }, {} as never));
    expect(result.success).toBe(true);
    expect(result.stdout).toContain('a.txt');
    expect(result.stdout).toContain('b.txt');
  });

  it('captures exit code for failing command', async () => {
    const shell = createShellTool(tmpDir);
    const result = parse(await shell.execute!({ command: 'false' }, {} as never));
    expect(result.success).toBe(true);
    expect(result.exitCode).not.toBe(0);
    expect(result.status).toBe('failed');
  });

  it('rejects interactive commands', async () => {
    const shell = createShellTool(tmpDir);
    const result = parse(await shell.execute!({ command: 'vim test.txt' }, {} as never));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Interactive');
  });

  it('respects custom working directory', async () => {
    const { realpathSync } = await import('node:fs');
    const realTmpDir = realpathSync(tmpDir);
    const shell = createShellTool(realTmpDir);
    const result = parse(await shell.execute!({ command: 'pwd', cwd: realTmpDir }, {} as never));
    expect(result.success).toBe(true);
    expect((result.stdout as string).trim()).toBe(realTmpDir);
  });

  it('times out on long-running commands', async () => {
    const shell = createShellTool(tmpDir);
    const result = parse(await shell.execute!({ command: 'sleep 10', timeout: 500 }, {} as never));
    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
  }, 10000);
});

describe('background tool', () => {
  it('starts process and retrieves output', async () => {
    const bg = createBackgroundTool();
    const startResult = parse(
      await bg.execute!({ operation: 'start', command: 'echo bg-output' }, {} as never),
    );
    expect(startResult.success).toBe(true);
    const sessionId = startResult.sessionId as string;
    expect(sessionId).toBeTruthy();

    await new Promise((r) => setTimeout(r, 500));

    const outputResult = parse(await bg.execute!({ operation: 'output', sessionId }, {} as never));
    expect(outputResult.success).toBe(true);
    expect(outputResult.stdout).toContain('bg-output');
  });

  it('lists active sessions', async () => {
    const bg = createBackgroundTool();
    await bg.execute!({ operation: 'start', command: 'sleep 5' }, {} as never);
    const listResult = parse(await bg.execute!({ operation: 'list' }, {} as never));
    expect(listResult.success).toBe(true);
    expect(Array.isArray(listResult.sessions)).toBe(true);
    expect((listResult.sessions as unknown[]).length).toBeGreaterThanOrEqual(1);
  });
});
