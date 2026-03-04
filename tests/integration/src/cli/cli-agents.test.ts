import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const CLI_PATH = resolve(__dirname, '../../../../packages/cli/dist/cli.js');
const NODE = process.execPath;

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'agntk-agents-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function runCLI(
  args: string[],
  extraEnv: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const env = {
    ...process.env,
    AGNTK_TEST_MODE: '1',
    HOME: tmpDir,
    AI_SDK_LOG_WARNINGS: 'false',
    ...extraEnv,
  };

  try {
    const result = await execFileAsync(NODE, [CLI_PATH, ...args], {
      env,
      timeout: 15_000,
      encoding: 'utf-8',
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number | string };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      exitCode: typeof e.code === 'number' ? e.code : 1,
    };
  }
}

describe('agent creation via CLI', () => {
  it('-n creates agent state directory', async () => {
    const { exitCode } = await runCLI(['-n', 'test-creator', '-q', '--workspace', tmpDir, 'hello']);
    expect(exitCode).toBe(0);
    const agentDir = join(tmpDir, '.agntk', 'agents', 'test-creator');
    expect(existsSync(agentDir)).toBe(true);
  });

  it('-n creates memory and workspace subdirectories', async () => {
    const { exitCode } = await runCLI([
      '-n',
      'test-structure',
      '-q',
      '--workspace',
      tmpDir,
      'hello',
    ]);
    expect(exitCode).toBe(0);
    const agentDir = join(tmpDir, '.agntk', 'agents', 'test-structure');
    expect(existsSync(join(agentDir, 'memory'))).toBe(true);
    expect(existsSync(join(agentDir, 'workspace'))).toBe(true);
    expect(existsSync(join(agentDir, 'archive'))).toBe(true);
  });
});

describe('agent listing via CLI', () => {
  it('list shows created agent by name', async () => {
    await runCLI(['-n', 'listed-agent', '-q', '--workspace', tmpDir, 'hello']);

    const { stdout, exitCode } = await runCLI(['list']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('listed-agent');
  });

  it('list shows multiple agents', async () => {
    await runCLI(['-n', 'alpha-agent', '-q', '--workspace', tmpDir, 'hello']);
    await runCLI(['-n', 'beta-agent', '-q', '--workspace', tmpDir, 'hello']);

    const { stdout, exitCode } = await runCLI(['list']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('alpha-agent');
    expect(stdout).toContain('beta-agent');
  });

  it('list shows memory indicator for memory/ directory with .md files (Bug #3 regression)', async () => {
    await runCLI(['-n', 'mem-agent', '-q', '--workspace', tmpDir, 'hello']);
    const memDir = join(tmpDir, '.agntk', 'agents', 'mem-agent', 'memory');
    await writeFile(join(memDir, 'knowledge.md'), '# Project notes\nImportant stuff.', 'utf-8');

    const { stdout, exitCode } = await runCLI(['list']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('mem-agent');
    expect(stdout).toContain('memory');
  });

  it('list shows memory indicator for old memory.md format', async () => {
    const agentDir = join(tmpDir, '.agntk', 'agents', 'legacy-agent');
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, 'memory.md'), '# Old format\nLegacy notes.', 'utf-8');

    const { stdout, exitCode } = await runCLI(['list']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('legacy-agent');
    expect(stdout).toContain('memory');
  });

  it('list shows idle for agent not running', async () => {
    await runCLI(['-n', 'idle-agent', '-q', '--workspace', tmpDir, 'hello']);

    const { stdout, exitCode } = await runCLI(['list']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('idle-agent');
    expect(stdout).toContain('idle');
  });
});
