/**
 * @file Tests for shell completion script generation.
 */
import { describe, it, expect } from 'vitest';
import { generateCompletionScript } from '../completions';
import { CLI_COMMANDS, COMMANDS_WITH_AGENT_ARG } from '../args';

describe('generateCompletionScript', () => {
  describe('bash', () => {
    const script = generateCompletionScript('bash');

    it('contains bash completion boilerplate', () => {
      expect(script).toContain('_agntk_completions');
      expect(script).toContain('complete -F _agntk_completions agntk');
      expect(script).toContain('_init_completion');
    });

    it('includes all CLI commands', () => {
      for (const cmd of CLI_COMMANDS) {
        expect(script).toContain(cmd);
      }
    });

    it('handles agent name completion for info/delete/stop', () => {
      for (const cmd of COMMANDS_WITH_AGENT_ARG) {
        expect(script).toContain(cmd);
      }
      expect(script).toContain('.agntk/agents');
    });

    it('handles completions subcommand with shell options', () => {
      expect(script).toContain('bash zsh fish');
    });
  });

  describe('zsh', () => {
    const script = generateCompletionScript('zsh');

    it('contains zsh completion boilerplate', () => {
      expect(script).toContain('#compdef agntk');
      expect(script).toContain('_agntk');
      expect(script).toContain('_arguments');
    });

    it('includes all CLI commands', () => {
      for (const cmd of CLI_COMMANDS) {
        expect(script).toContain(cmd);
      }
    });

    it('handles agent name completion', () => {
      expect(script).toContain('info|delete|stop');
      expect(script).toContain('.agntk/agents');
    });

    it('handles completions subcommand with shell values', () => {
      expect(script).toContain('_values');
      expect(script).toContain('bash zsh fish');
    });
  });

  describe('fish', () => {
    const script = generateCompletionScript('fish');

    it('contains fish completion boilerplate', () => {
      expect(script).toContain('complete -c agntk');
      expect(script).toContain('__fish_seen_subcommand_from');
    });

    it('includes all CLI commands', () => {
      for (const cmd of CLI_COMMANDS) {
        expect(script).toContain(cmd);
      }
    });

    it('handles agent name completion for info/delete/stop', () => {
      for (const cmd of COMMANDS_WITH_AGENT_ARG) {
        expect(script).toContain(`__fish_seen_subcommand_from ${cmd}`);
      }
      expect(script).toContain('__agntk_agents');
    });

    it('handles completions subcommand with shell options', () => {
      expect(script).toContain('bash zsh fish');
    });

    it('includes flag definitions', () => {
      expect(script).toContain('-l name');
      expect(script).toContain('-l interactive');
      expect(script).toContain('-l verbose');
      expect(script).toContain('-l help');
    });
  });
});
