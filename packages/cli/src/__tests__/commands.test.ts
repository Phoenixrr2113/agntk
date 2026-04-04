/**
 * @file Tests for slash command registry and completer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:fs before importing commands
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readdirSync: vi.fn(() => []),
    statSync: vi.fn(() => ({ size: 100, mtime: new Date() })),
  };
});

import {
  getCommand,
  getAllCommands,
  getCommandNames,
  createCompleter,
  getAgentNames,
} from '../commands';
import { existsSync, readdirSync } from 'node:fs';

/*
 * ============================================================================
 * Registry
 * ============================================================================
 */

describe('command registry', () => {
  it('has built-in commands registered', () => {
    const names = getCommandNames();
    expect(names).toContain('help');
    expect(names).toContain('tools');
    expect(names).toContain('verbose');
    expect(names).toContain('exit');
    expect(names).toContain('quit');
    expect(names).toContain('agents');
    expect(names).toContain('memory');
    expect(names).toContain('model');
    expect(names).toContain('clear');
    expect(names).toContain('status');
  });

  it('getCommand returns defined command', () => {
    const cmd = getCommand('help');
    expect(cmd).toBeDefined();
    expect(cmd!.name).toBe('help');
    expect(cmd!.description).toBeTruthy();
    expect(typeof cmd!.execute).toBe('function');
  });

  it('getCommand returns undefined for unknown command', () => {
    expect(getCommand('nonexistent')).toBeUndefined();
  });

  it('getAllCommands returns array with all registered commands', () => {
    const cmds = getAllCommands();
    expect(cmds.length).toBeGreaterThanOrEqual(10);
    expect(cmds.every((c) => c.name && c.description && c.execute)).toBe(true);
  });
});

/*
 * ============================================================================
 * Completer
 * ============================================================================
 */

describe('createCompleter', () => {
  const completer = createCompleter();

  /**
   *
   * @param line
   */
  function complete(line: string): Promise<[string[], string]> {
    return new Promise((resolve) => {
      completer(line, (err, result) => {
        expect(err).toBeNull();
        resolve(result);
      });
    });
  }

  it('returns no completions for non-slash input', async () => {
    const [matches, line] = await complete('hello');
    expect(matches).toEqual([]);
    expect(line).toBe('hello');
  });

  it('returns no completions for empty input', async () => {
    const [matches] = await complete('');
    expect(matches).toEqual([]);
  });

  it('returns all commands for bare "/"', async () => {
    const [matches, line] = await complete('/');
    expect(matches.length).toBeGreaterThanOrEqual(10);
    expect(matches.every((m: string) => m.startsWith('/'))).toBe(true);
    expect(line).toBe('/');
  });

  it('prefix-matches "/he" to ["/help"]', async () => {
    const [matches] = await complete('/he');
    expect(matches).toEqual(['/help']);
  });

  it('prefix-matches "/ex" to ["/exit"]', async () => {
    const [matches] = await complete('/ex');
    expect(matches).toEqual(['/exit']);
  });

  it('prefix-matches "/cl" to ["/clear"]', async () => {
    const [matches] = await complete('/cl');
    expect(matches).toEqual(['/clear']);
  });

  it('returns empty for unmatched prefix', async () => {
    const [matches] = await complete('/zzz');
    expect(matches).toEqual([]);
  });

  it('returns empty for command arg when no completeArg defined', async () => {
    const [matches] = await complete('/help something');
    expect(matches).toEqual([]);
  });
});

/*
 * ============================================================================
 * Agent Name Helper
 * ============================================================================
 */

describe('getAgentNames', () => {
  beforeEach(() => {
    vi.mocked(existsSync).mockReset();
    vi.mocked(readdirSync).mockReset();
  });

  it('returns empty when agents dir does not exist', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(getAgentNames()).toEqual([]);
  });

  it('returns agent names sorted', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue([
      { name: 'coder', isDirectory: () => true, isFile: () => false },
      { name: 'alpha', isDirectory: () => true, isFile: () => false },
    ] as unknown as ReturnType<typeof readdirSync>);

    expect(getAgentNames()).toEqual(['alpha', 'coder']);
  });

  it('filters out sub-agent directories', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue([
      { name: 'coder', isDirectory: () => true, isFile: () => false },
      { name: 'coder_researcher', isDirectory: () => true, isFile: () => false },
      { name: 'ops', isDirectory: () => true, isFile: () => false },
    ] as unknown as ReturnType<typeof readdirSync>);

    expect(getAgentNames()).toEqual(['coder', 'ops']);
  });

  it('ignores non-directory entries', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue([
      { name: 'coder', isDirectory: () => true, isFile: () => false },
      { name: '.DS_Store', isDirectory: () => false, isFile: () => true },
    ] as unknown as ReturnType<typeof readdirSync>);

    expect(getAgentNames()).toEqual(['coder']);
  });
});
