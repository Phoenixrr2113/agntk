/**
 * @file Slash command registry, completer factory, and built-in command handlers.
 * Provides TAB completion in the REPL and a pluggable command system.
 */
import { readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import type { Interface } from 'node:readline';
import { AGENT_STATE_BASE } from '@agntk/core';
import type { Agent } from '@agntk/core';
import type { CLIArgs, OutputLevel } from './args';
import type { Colors } from './ui';

/*
 * ============================================================================
 * Types
 * ============================================================================
 */

export interface CommandContext {
  agent: Agent;
  args: CLIArgs;
  colors: Colors;
  output: NodeJS.WritableStream;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  rl: Interface;
}

export interface SlashCommand {
  name: string;
  description: string;
  execute: (ctx: CommandContext) => void | Promise<void>;
  completeArg?: (partial: string) => string[];
}

/*
 * ============================================================================
 * Registry
 * ============================================================================
 */

const registry = new Map<string, SlashCommand>();

/**
 *
 * @param cmd
 */
export function registerCommand(cmd: SlashCommand): void {
  registry.set(cmd.name, cmd);
}

/**
 *
 * @param name
 */
export function getCommand(name: string): SlashCommand | undefined {
  return registry.get(name);
}

/**
 *
 */
export function getAllCommands(): SlashCommand[] {
  return [...registry.values()];
}

/**
 *
 */
export function getCommandNames(): string[] {
  return [...registry.keys()];
}

/*
 * ============================================================================
 * Agent Name Helper
 * ============================================================================
 */

const AGENTS_DIR = resolve(homedir(), AGENT_STATE_BASE);

/**
 *
 */
export function getAgentNames(): string[] {
  if (!existsSync(AGENTS_DIR)) return [];

  const entries = readdirSync(AGENTS_DIR, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory());
  const names = dirs.map((d) => d.name);

  // Filter out sub-agent directories (name starts with another agent's name + "_")
  const parents = names.filter(
    (name) => !names.some((other) => other !== name && name.startsWith(`${other}_`)),
  );

  return parents.sort();
}

/*
 * ============================================================================
 * Completer
 * ============================================================================
 */

/**
 *
 */
export function createCompleter(): (
  line: string,
  callback: (err: Error | null, result: [string[], string]) => void,
) => void {
  return (line: string, callback: (err: Error | null, result: [string[], string]) => void) => {
    if (!line.startsWith('/')) {
      callback(null, [[], line]);
      return;
    }

    const spaceIdx = line.indexOf(' ');

    if (spaceIdx === -1) {
      // Completing command name: "/he" → ["/help"]
      const partial = line.slice(1);
      const matches = getCommandNames()
        .filter((name) => name.startsWith(partial))
        .map((name) => `/${name}`);
      callback(null, [matches, line]);
      return;
    }

    // Completing command argument: "/info cod" → ["/info coder"]
    const cmdName = line.slice(1, spaceIdx);
    const argPartial = line.slice(spaceIdx + 1);
    const cmd = getCommand(cmdName);

    if (cmd?.completeArg) {
      const argMatches = cmd.completeArg(argPartial);
      const matches = argMatches.map((arg) => `/${cmdName} ${arg}`);
      callback(null, [matches, line]);
      return;
    }

    callback(null, [[], line]);
  };
}

/*
 * ============================================================================
 * Format Helpers (local to commands)
 * ============================================================================
 */

/**
 *
 * @param bytes
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/*
 * ============================================================================
 * Phase 1 Commands
 * ============================================================================
 */

registerCommand({
  name: 'help',
  description: 'Show available commands',
  execute({ output, colors }) {
    const cmds = getAllCommands();
    const maxLen = Math.max(...cmds.map((c) => c.name.length));
    output.write('\n');
    for (const cmd of cmds) {
      const padding = ' '.repeat(maxLen - cmd.name.length + 2);
      output.write(`  ${colors.bold(`/${cmd.name}`)}${padding}${colors.dim(cmd.description)}\n`);
    }
    output.write('\n');
  },
});

registerCommand({
  name: 'tools',
  description: 'List available tools',
  execute({ agent, output, colors }) {
    const tools = agent.getToolNames();
    output.write(`\n${colors.bold(`Tools (${tools.length})`)}:\n  ${tools.join(', ')}\n\n`);
  },
});

registerCommand({
  name: 'verbose',
  description: 'Toggle verbose output',
  execute({ args, output, colors }) {
    if (args.outputLevel === 'verbose') {
      args.outputLevel = 'normal' as OutputLevel;
      output.write(`${colors.dim('Verbose output: off')}\n`);
    } else {
      args.outputLevel = 'verbose' as OutputLevel;
      output.write(`${colors.dim('Verbose output: on')}\n`);
    }
  },
});

registerCommand({
  name: 'exit',
  description: 'Quit the REPL',
  execute({ rl }) {
    rl.close();
  },
});

registerCommand({
  name: 'quit',
  description: 'Quit the REPL',
  execute({ rl }) {
    rl.close();
  },
});

/*
 * ============================================================================
 * Phase 3 Commands
 * ============================================================================
 */

registerCommand({
  name: 'agents',
  description: 'List all agents',
  async execute() {
    const { listAgents } = await import('./agents.js');
    listAgents();
  },
});

registerCommand({
  name: 'memory',
  description: 'Show current agent memory files',
  execute({ args, output, colors }) {
    if (!args.name) {
      output.write(`${colors.dim('No agent name set.')}\n`);
      return;
    }

    const memoryDir = join(AGENTS_DIR, args.name, 'memory');

    if (!existsSync(memoryDir)) {
      output.write(`${colors.dim('No memory files found.')}\n`);
      return;
    }

    const files = readdirSync(memoryDir).filter((f) => f.endsWith('.md'));

    if (files.length === 0) {
      output.write(`${colors.dim('No memory files found.')}\n`);
      return;
    }

    output.write(`\n${colors.bold(`Memory (${files.length} files)`)}\n`);
    for (const file of files) {
      const st = statSync(join(memoryDir, file));
      output.write(`  ${file}  ${colors.dim(formatBytes(st.size))}\n`);
    }
    output.write('\n');
  },
});

registerCommand({
  name: 'model',
  description: 'Show current model info',
  execute({ agent, output, colors }) {
    output.write(`${colors.bold('Model:')} ${agent.getModelId()}\n`);
  },
});

registerCommand({
  name: 'clear',
  description: 'Clear conversation history',
  execute({ history, output, colors }) {
    const count = history.length;
    history.length = 0;
    output.write(`${colors.dim(`Cleared ${count} messages.`)}\n`);
  },
});

registerCommand({
  name: 'status',
  description: 'Show session status',
  execute({ agent, args, output, colors, history }) {
    const turns = history.filter((h) => h.role === 'user').length;
    const model = agent.getModelId();
    const toolCount = agent.getToolNames().length;

    output.write('\n');
    output.write(`  ${colors.bold('Agent:')}     ${args.name ?? 'default'}\n`);
    output.write(`  ${colors.bold('Model:')}     ${model}\n`);
    output.write(`  ${colors.bold('Tools:')}     ${toolCount}\n`);
    output.write(`  ${colors.bold('Turns:')}     ${turns}\n`);
    output.write(`  ${colors.bold('Messages:')}  ${history.length}\n`);
    output.write(
      `  ${colors.bold('Verbose:')}   ${args.outputLevel === 'verbose' ? 'on' : 'off'}\n`,
    );
    output.write('\n');
  },
});
