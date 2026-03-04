import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { parseCLIArgs } from '../../../../packages/cli/src/args';

const execFileAsync = promisify(execFile);

const CLI_PATH = resolve(__dirname, '../../../../packages/cli/dist/cli.js');
const NODE = process.execPath;

async function runCLI(
  args: string[],
  options: { env?: Record<string, string>; input?: string; timeout?: number } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const env = {
    ...process.env,
    AI_SDK_LOG_WARNINGS: 'false',
    ...options.env,
  };

  try {
    const result = await execFileAsync(NODE, [CLI_PATH, ...args], {
      env,
      timeout: options.timeout ?? 15_000,
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

describe('parseCLIArgs', () => {
  it('defaults: no args', () => {
    const args = parseCLIArgs([]);
    expect(args.name).toBeNull();
    expect(args.prompt).toBeNull();
    expect(args.interactive).toBe(false);
    expect(args.outputLevel).toBe('normal');
    expect(args.maxSteps).toBe(0);
    expect(args.help).toBe(false);
    expect(args.version).toBe(false);
    expect(args.command).toBeNull();
  });

  it('--version flag', () => {
    const args = parseCLIArgs(['--version']);
    expect(args.version).toBe(true);
  });

  it('-v flag (short version)', () => {
    const args = parseCLIArgs(['-v']);
    expect(args.version).toBe(true);
  });

  it('--help flag', () => {
    const args = parseCLIArgs(['--help']);
    expect(args.help).toBe(true);
  });

  it('-h flag (short help)', () => {
    const args = parseCLIArgs(['-h']);
    expect(args.help).toBe(true);
  });

  it('list command', () => {
    const args = parseCLIArgs(['list']);
    expect(args.command).toBe('list');
    expect(args.prompt).toBeNull();
  });

  it('list as positional (not first arg)', () => {
    const args = parseCLIArgs(['hello', 'list']);
    expect(args.command).toBeNull();
    expect(args.prompt).toBe('hello list');
  });

  it('info command with name', () => {
    const args = parseCLIArgs(['info', 'my-agent']);
    expect(args.command).toBe('info');
    expect(args.commandArg).toBe('my-agent');
  });

  it('delete command with name', () => {
    const args = parseCLIArgs(['delete', 'old-agent']);
    expect(args.command).toBe('delete');
    expect(args.commandArg).toBe('old-agent');
  });

  it('clean command (no arg)', () => {
    const args = parseCLIArgs(['clean']);
    expect(args.command).toBe('clean');
    expect(args.commandArg).toBeNull();
  });

  it('-n / --name flag', () => {
    const args = parseCLIArgs(['-n', 'my-agent', 'do something']);
    expect(args.name).toBe('my-agent');
    expect(args.prompt).toBe('do something');
  });

  it('--instructions flag', () => {
    const args = parseCLIArgs(['--instructions', 'You are a tester.', 'test it']);
    expect(args.instructions).toBe('You are a tester.');
    expect(args.prompt).toBe('test it');
  });

  it('-i / --interactive flag', () => {
    const args = parseCLIArgs(['-n', 'repl-agent', '-i']);
    expect(args.interactive).toBe(true);
    expect(args.name).toBe('repl-agent');
  });

  it('--workspace flag', () => {
    const args = parseCLIArgs(['--workspace', '/tmp/myproject', 'hello']);
    expect(args.workspace).toBe('/tmp/myproject');
  });

  it('-q / --quiet flag', () => {
    const args = parseCLIArgs(['-q', 'hello']);
    expect(args.outputLevel).toBe('quiet');
  });

  it('--verbose flag', () => {
    const args = parseCLIArgs(['--verbose', 'hello']);
    expect(args.outputLevel).toBe('verbose');
  });

  it('--max-steps with valid number', () => {
    const args = parseCLIArgs(['--max-steps', '10', 'hello']);
    expect(args.maxSteps).toBe(10);
  });

  it('--max-steps 0 means unlimited', () => {
    const args = parseCLIArgs(['--max-steps', '0', 'hello']);
    expect(args.maxSteps).toBe(0);
  });

  it('--max-steps negative maps to unlimited (0)', () => {
    const args = parseCLIArgs(['--max-steps', '-5', 'hello']);
    expect(args.maxSteps).toBe(0);
  });

  it('--max-steps NaN defaults to unlimited (0)', () => {
    const args = parseCLIArgs(['--max-steps', 'abc', 'hello']);
    expect(args.maxSteps).toBe(0);
  });

  it('positionals join into prompt', () => {
    const args = parseCLIArgs(['fix', 'the', 'failing', 'tests']);
    expect(args.prompt).toBe('fix the failing tests');
  });

  it('quoted prompt stays as single string', () => {
    const args = parseCLIArgs(['fix the failing tests']);
    expect(args.prompt).toBe('fix the failing tests');
  });

  it('unknown flags are ignored', () => {
    const args = parseCLIArgs(['--unknown', 'hello']);
    expect(args.prompt).toBe('hello');
  });
});

describe('CLI binary fast paths', () => {
  it('--version prints version and exits 0', async () => {
    const { stdout, exitCode } = await runCLI(['--version']);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/agntk \(\d+\.\d+\.\d+\)/);
  });

  it('--help prints usage and exits 0', async () => {
    const { stdout, exitCode } = await runCLI(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage:');
    expect(stdout).toContain('Options:');
    expect(stdout).toContain('--name');
  });

  it('no args exits 1 with usage hint', async () => {
    const { exitCode } = await runCLI([], {
      env: { FORCE_STDIN_TTY: '1' },
    });
    expect(exitCode).not.toBe(0);
  });

  it('list with no agents shows "No agents found"', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'agntk-cli-test-'));
    try {
      const { stdout, exitCode } = await runCLI(['list'], {
        env: { HOME: tmpDir },
      });
      expect(exitCode).toBe(0);
      expect(stdout).toContain('No agents found');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('CLI binary with AGNTK_TEST_MODE', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'agntk-cli-testmode-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const testEnv = (extra: Record<string, string> = {}) => ({
    AGNTK_TEST_MODE: '1',
    HOME: tmpDir,
    ...extra,
  });

  it('one-shot with prompt returns test response', async () => {
    const { stdout, exitCode } = await runCLI(['-q', '--workspace', tmpDir, 'hello'], {
      env: testEnv(),
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Test response.');
  });

  it('quiet mode suppresses step markers', async () => {
    const { stdout, exitCode } = await runCLI(['-q', '--workspace', tmpDir, 'hello'], {
      env: testEnv(),
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Test response.');
    expect(stdout).not.toContain('step 1');
    expect(stdout).not.toContain('agntk');
  });

  it('normal mode includes step markers on stderr', async () => {
    const { stdout, stderr, exitCode } = await runCLI(['--workspace', tmpDir, 'hello'], {
      env: testEnv(),
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Test response.');
    expect(stderr).toContain('step 1');
    expect(stderr).toContain('done');
  });

  it('verbose mode includes usage info', async () => {
    const { stderr, exitCode } = await runCLI(['--verbose', '--workspace', tmpDir, 'hello'], {
      env: testEnv(),
    });
    expect(exitCode).toBe(0);
    expect(stderr).toContain('usage');
  });

  it('--instructions flag is accepted', async () => {
    const { stdout, exitCode } = await runCLI(
      ['-q', '--workspace', tmpDir, '--instructions', 'You are a test bot.', 'hello'],
      { env: testEnv() },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Test response.');
  });

  it('--max-steps 1 still completes', async () => {
    const { stdout, exitCode } = await runCLI(
      ['-q', '--workspace', tmpDir, '--max-steps', '1', 'hello'],
      { env: testEnv() },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Test response.');
  });
});
