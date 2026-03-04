import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const CLI_PATH = resolve(__dirname, '../../../../packages/cli/dist/cli.js');
const NODE = process.execPath;

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'agntk-mgmt-test-'));
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

// ============================================================================
// info command
// ============================================================================

describe('info command', () => {
  it('shows agent name, path, and disk size for an existing agent', async () => {
    const agentDir = join(tmpDir, '.agntk', 'agents', 'test-info');
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, 'memory.md'), '# Notes\nSome content.', 'utf-8');

    const { stdout, exitCode } = await runCLI(['info', 'test-info']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('test-info');
    expect(stdout).toContain('Path:');
    expect(stdout).toContain('Disk:');
  });

  it('exits with code 1 and shows not found for nonexistent agent', async () => {
    const { stderr, exitCode } = await runCLI(['info', 'nonexistent']);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('not found');
  });

  it('shows memory files when they exist in memory/ subdirectory', async () => {
    const agentDir = join(tmpDir, '.agntk', 'agents', 'mem-info');
    const memDir = join(agentDir, 'memory');
    await mkdir(memDir, { recursive: true });
    await writeFile(join(memDir, 'knowledge.md'), '# Knowledge\nImportant facts.', 'utf-8');
    await writeFile(join(memDir, 'tasks.md'), '# Tasks\n- Fix bug', 'utf-8');

    const { stdout, exitCode } = await runCLI(['info', 'mem-info']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Memory');
    expect(stdout).toContain('knowledge.md');
    expect(stdout).toContain('tasks.md');
  });

  it('shows root-level files in Files section', async () => {
    const agentDir = join(tmpDir, '.agntk', 'agents', 'files-info');
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, 'context.md'), '# Context\nProject info.', 'utf-8');

    const { stdout, exitCode } = await runCLI(['info', 'files-info']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Files');
    expect(stdout).toContain('context.md');
  });

  it('shows idle status when agent is not running', async () => {
    const agentDir = join(tmpDir, '.agntk', 'agents', 'idle-info');
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, 'memory.md'), '# Notes', 'utf-8');

    const { stdout, exitCode } = await runCLI(['info', 'idle-info']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('idle');
  });
});

// ============================================================================
// delete command
// ============================================================================

describe('delete command', () => {
  it('exits with code 1 and shows not found for nonexistent agent', async () => {
    const { stderr, exitCode } = await runCLI(['delete', 'nonexistent']);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('not found');
  });
});

// ============================================================================
// stop command
// ============================================================================

describe('stop command', () => {
  it('exits with code 1 and shows not found for nonexistent agent', async () => {
    const { stderr, exitCode } = await runCLI(['stop', 'nonexistent']);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('not found');
  });

  it('shows not running for an idle agent', async () => {
    const agentDir = join(tmpDir, '.agntk', 'agents', 'idle-agent');
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, 'memory.md'), '# Notes', 'utf-8');

    const { stdout, exitCode } = await runCLI(['stop', 'idle-agent']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('not running');
  });
});

// ============================================================================
// clean command
// ============================================================================

describe('clean command', () => {
  it('shows no agents found when agents directory does not exist', async () => {
    const { stdout, exitCode } = await runCLI(['clean']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('No agents found');
  });

  it('shows no agents found when agents directory is empty', async () => {
    const agentsDir = join(tmpDir, '.agntk', 'agents');
    await mkdir(agentsDir, { recursive: true });

    const { stdout, exitCode } = await runCLI(['clean']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('No agents found');
  });
});
