/**
 * @fileoverview Tests for CLI argument parsing.
 */
import { describe, it, expect } from 'vitest';
import { parseCLIArgs } from '../args';

describe('parseCLIArgs', () => {
  describe('defaults', () => {
    it('returns default values when no args are given', () => {
      const result = parseCLIArgs([]);
      expect(result.name).toBeNull();
      expect(result.instructions).toBeNull();
      expect(result.prompt).toBeNull();
      expect(result.interactive).toBe(false);
      expect(result.outputLevel).toBe('normal');
      expect(result.maxSteps).toBe(0);
      expect(result.help).toBe(false);
      expect(result.version).toBe(false);
      expect(result.command).toBeNull();
      expect(result.commandArg).toBeNull();
    });
  });

  describe('--name / -n', () => {
    it('parses --name flag', () => {
      const result = parseCLIArgs(['--name', 'coder']);
      expect(result.name).toBe('coder');
    });

    it('parses -n shorthand', () => {
      const result = parseCLIArgs(['-n', 'coder']);
      expect(result.name).toBe('coder');
    });

    it('sets name to null when flag has no value', () => {
      const result = parseCLIArgs(['--name']);
      expect(result.name).toBeNull();
    });
  });

  describe('--instructions', () => {
    it('parses --instructions flag', () => {
      const result = parseCLIArgs(['--instructions', 'You are a helpful assistant']);
      expect(result.instructions).toBe('You are a helpful assistant');
    });

    it('sets instructions to null when flag has no value', () => {
      const result = parseCLIArgs(['--instructions']);
      expect(result.instructions).toBeNull();
    });
  });

  describe('--interactive / -i', () => {
    it('parses --interactive flag', () => {
      const result = parseCLIArgs(['--interactive']);
      expect(result.interactive).toBe(true);
    });

    it('parses -i shorthand', () => {
      const result = parseCLIArgs(['-i']);
      expect(result.interactive).toBe(true);
    });
  });

  describe('--workspace', () => {
    it('parses --workspace flag', () => {
      const result = parseCLIArgs(['--workspace', '/tmp/work']);
      expect(result.workspace).toBe('/tmp/work');
    });

    it('falls back to cwd when --workspace has no value', () => {
      const result = parseCLIArgs(['--workspace']);
      expect(result.workspace).toBe(process.cwd());
    });
  });

  describe('output level', () => {
    it('parses --verbose flag', () => {
      const result = parseCLIArgs(['--verbose']);
      expect(result.outputLevel).toBe('verbose');
    });

    it('parses --quiet flag', () => {
      const result = parseCLIArgs(['--quiet']);
      expect(result.outputLevel).toBe('quiet');
    });

    it('parses -q shorthand', () => {
      const result = parseCLIArgs(['-q']);
      expect(result.outputLevel).toBe('quiet');
    });
  });

  describe('--max-steps', () => {
    it('parses a valid positive integer', () => {
      const result = parseCLIArgs(['--max-steps', '20']);
      expect(result.maxSteps).toBe(20);
    });

    it('treats zero as unlimited (0)', () => {
      const result = parseCLIArgs(['--max-steps', '0']);
      expect(result.maxSteps).toBe(0);
    });

    it('treats a negative number as unlimited (0)', () => {
      const result = parseCLIArgs(['--max-steps', '-5']);
      expect(result.maxSteps).toBe(0);
    });

    it('treats a non-numeric value as unlimited (0)', () => {
      const result = parseCLIArgs(['--max-steps', 'abc']);
      expect(result.maxSteps).toBe(0);
    });

    it('treats missing value as unlimited (0)', () => {
      const result = parseCLIArgs(['--max-steps']);
      expect(result.maxSteps).toBe(0);
    });
  });

  describe('--help / -h', () => {
    it('parses --help flag', () => {
      const result = parseCLIArgs(['--help']);
      expect(result.help).toBe(true);
    });

    it('parses -h shorthand', () => {
      const result = parseCLIArgs(['-h']);
      expect(result.help).toBe(true);
    });
  });

  describe('--version / -v', () => {
    it('parses --version flag', () => {
      const result = parseCLIArgs(['--version']);
      expect(result.version).toBe(true);
    });

    it('parses -v shorthand', () => {
      const result = parseCLIArgs(['-v']);
      expect(result.version).toBe(true);
    });
  });

  describe('positional prompt', () => {
    it('captures a single positional as prompt', () => {
      const result = parseCLIArgs(['fix the tests']);
      expect(result.prompt).toBe('fix the tests');
    });

    it('joins multiple positionals with a space', () => {
      const result = parseCLIArgs(['fix', 'the', 'tests']);
      expect(result.prompt).toBe('fix the tests');
    });

    it('does not treat flags as positionals', () => {
      const result = parseCLIArgs(['--verbose', 'my prompt']);
      expect(result.prompt).toBe('my prompt');
    });
  });

  describe('commands', () => {
    it('parses the list command', () => {
      const result = parseCLIArgs(['list']);
      expect(result.command).toBe('list');
      expect(result.commandArg).toBeNull();
    });

    it('parses the info command with an argument', () => {
      const result = parseCLIArgs(['info', 'coder']);
      expect(result.command).toBe('info');
      expect(result.commandArg).toBe('coder');
    });

    it('parses the delete command with an argument', () => {
      const result = parseCLIArgs(['delete', 'old-agent']);
      expect(result.command).toBe('delete');
      expect(result.commandArg).toBe('old-agent');
    });

    it('parses the stop command with an argument', () => {
      const result = parseCLIArgs(['stop', 'coder']);
      expect(result.command).toBe('stop');
      expect(result.commandArg).toBe('coder');
    });

    it('parses the clean command', () => {
      const result = parseCLIArgs(['clean']);
      expect(result.command).toBe('clean');
      expect(result.commandArg).toBeNull();
    });

    it('does not treat a flag-like string as a commandArg', () => {
      const result = parseCLIArgs(['info', '--verbose']);
      expect(result.command).toBe('info');
      expect(result.commandArg).toBeNull();
    });

    it('does not treat a second command keyword as commandArg for the first', () => {
      // When two commands appear, the second overrides the first because
      // the positionals array is still empty when the second is seen.
      const result = parseCLIArgs(['info', 'list']);
      expect(result.command).toBe('list');
      expect(result.commandArg).toBeNull();
    });
  });

  describe('combined usage', () => {
    it('handles -n with a prompt', () => {
      const result = parseCLIArgs(['-n', 'coder', 'fix the tests']);
      expect(result.name).toBe('coder');
      expect(result.prompt).toBe('fix the tests');
    });

    it('handles -n, --instructions, and --max-steps together', () => {
      const result = parseCLIArgs([
        '-n',
        'ops',
        '--instructions',
        'you manage k8s',
        '--max-steps',
        '10',
        'roll back staging',
      ]);
      expect(result.name).toBe('ops');
      expect(result.instructions).toBe('you manage k8s');
      expect(result.maxSteps).toBe(10);
      expect(result.prompt).toBe('roll back staging');
    });

    it('handles -n with -i (interactive mode)', () => {
      const result = parseCLIArgs(['-n', 'coder', '-i']);
      expect(result.name).toBe('coder');
      expect(result.interactive).toBe(true);
      expect(result.prompt).toBeNull();
    });
  });
});
