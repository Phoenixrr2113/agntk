import { tool } from 'ai';

import { executeCommand, isDangerousCommand, validateCwd } from '../utils/shell';
import { success, error } from '../utils/tool-result';
import { ToolError, ToolErrorType } from '../utils/errors';

import { SHELL_DESCRIPTION, DEFAULT_TIMEOUT } from './constants';
import { shellInputSchema } from './types';
import { isInteractiveCommand, isCommandAllowed, addToAllowlist } from './utils';

export function createShellTool(workspaceRoot: string) {
  return tool({
    description: SHELL_DESCRIPTION,
    inputSchema: shellInputSchema,
    execute: async (input) => {
      const { command, cwd, timeout = DEFAULT_TIMEOUT, allow = false, stream = false } = input;

      if (isDangerousCommand(command)) {
        throw new ToolError(
          'Command blocked for safety. This command pattern is potentially destructive.',
          ToolErrorType.COMMAND_BLOCKED,
          { command: command.slice(0, 100), patterns: 'rm -rf, sudo, shutdown, etc.' }
        );
      }

      if (isInteractiveCommand(command)) {
        const firstWord = command.trim().split(/\s+/)[0];
        return error(`Interactive command '${firstWord}' not supported`, {
          suggestion: 'Use the fs tool to read/write files, or run non-interactive alternatives.',
        });
      }

      if (allow && !isCommandAllowed(command)) {
        addToAllowlist(command);
      }

      // S-13: Validate cwd is within workspace root
      let effectiveCwd: string;
      try {
        effectiveCwd = cwd ? validateCwd(cwd, workspaceRoot) : workspaceRoot;
      } catch (err) {
        return error(err instanceof Error ? err.message : 'Invalid working directory');
      }

      const result = await executeCommand(command, {
        cwd: effectiveCwd,
        timeout,
        maxBuffer: stream ? 10 * 1024 * 1024 : 1024 * 1024,
      });

      if (result.error) {
        return error(result.error, {
          command: command.slice(0, 100),
          cwd: effectiveCwd,
        });
      }

      if (result.killed) {
        return error('Command timed out', {
          timeout,
          durationMs: result.durationMs,
          stdoutPreview: result.stdout.slice(0, 500),
          stderrPreview: result.stderr.slice(0, 500),
          hint: 'Increase timeout or use delegate with background action for long-running commands.',
        });
      }

      const output = {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        durationMs: Math.round(result.durationMs),
      };

      if (result.exitCode !== 0) {
        return success({
          ...output,
          status: 'failed',
          hint: 'Non-zero exit code indicates command failure. Check stderr for details.',
        });
      }

      return success({
        ...output,
        status: 'success',
      });
    },
  });
}

export const shellTool = createShellTool(process.cwd());

// Direct export for testing (bypasses optional `execute` type from AI SDK)
export const executeShellCommand = shellTool.execute!;
