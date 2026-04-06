import { describe, it, expect } from 'vitest';
import { parseCLIArgs } from '../args';

describe('CLI harness commands', () => {
  it('parses install command with file arg', () => {
    const args = parseCLIArgs(['install', 'my-rule.md']);

    expect(args.command).toBe('install');
    expect(args.commandArg).toBe('my-rule.md');
  });

  it('parses uninstall command with path arg', () => {
    const args = parseCLIArgs(['uninstall', '/path/to/rule.md']);

    expect(args.command).toBe('uninstall');
    expect(args.commandArg).toBe('/path/to/rule.md');
  });

  it('parses evaluate command with file arg', () => {
    const args = parseCLIArgs(['evaluate', 'instinct.md']);

    expect(args.command).toBe('evaluate');
    expect(args.commandArg).toBe('instinct.md');
  });

  it('parses install with agent name', () => {
    const args = parseCLIArgs(['-n', 'my-agent', 'install', 'rule.md']);

    expect(args.command).toBe('install');
    expect(args.commandArg).toBe('rule.md');
    expect(args.name).toBe('my-agent');
  });
});
