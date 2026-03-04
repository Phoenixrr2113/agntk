import { tool } from 'ai';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { browserInputSchema, BROWSER_TOOL_DESCRIPTION } from './types';
import type { BrowserInput, BrowserConfig } from './types';
import { success, error } from '../utils/tool-result';
import {
  BROWSER_DEFAULT_TIMEOUT,
  BROWSER_MAX_OUTPUT_LENGTH,
  BROWSER_MAX_BUFFER,
} from '../../constants';

const execFileAsync = promisify(execFile);

const CLI_BINARY = 'agent-browser';

let cliAvailable: boolean | null = null;

export async function isBrowserCliAvailable(): Promise<boolean> {
  if (cliAvailable !== null) return cliAvailable;

  try {
    await execFileAsync('which', [CLI_BINARY]);
    cliAvailable = true;
  } catch {
    cliAvailable = false;
  }
  return cliAvailable;
}

export function resetCliAvailability(): void {
  cliAvailable = null;
}

export function buildCommand(input: BrowserInput, config: BrowserConfig = {}): string[] {
  const args: string[] = [];

  if (config.session) {
    args.push('--session', config.session);
  }
  if (config.cdpUrl) {
    args.push('--cdp', config.cdpUrl);
  }
  if (config.headless === false) {
    args.push('--no-headless');
  }

  switch (input.action) {
    case 'open':
      args.push('open', input.url);
      break;

    case 'snapshot':
      args.push('snapshot');
      if (input.interactive) args.push('-i');
      break;

    case 'click':
      args.push('click', input.selector);
      break;

    case 'dblclick':
      args.push('dblclick', input.selector);
      break;

    case 'fill':
      args.push('fill', input.selector, input.text);
      break;

    case 'type':
      args.push('type', input.selector, input.text);
      break;

    case 'select':
      args.push('select', input.selector, input.value);
      break;

    case 'press':
      args.push('press', input.key);
      break;

    case 'hover':
      args.push('hover', input.selector);
      break;

    case 'scroll':
      args.push('scroll', input.direction);
      if (input.pixels !== undefined) args.push(String(input.pixels));
      break;

    case 'screenshot': {
      const screenshotPath = input.path ?? join(tmpdir(), `browser-screenshot-${Date.now()}.png`);
      args.push('screenshot', screenshotPath);
      if (input.fullPage) args.push('--full');
      break;
    }

    case 'getText':
      args.push('get', 'text', input.selector);
      break;

    case 'getUrl':
      args.push('get', 'url');
      break;

    case 'getTitle':
      args.push('get', 'title');
      break;

    case 'wait':
      if (input.selector) {
        args.push('wait', input.selector);
      } else if (input.ms !== undefined) {
        args.push('wait', String(input.ms));
      } else if (input.text) {
        args.push('wait', '--text', input.text);
      } else if (input.url) {
        args.push('wait', '--url', input.url);
      } else if (input.load) {
        args.push('wait', '--load', input.load);
      } else {
        args.push('wait', '1000');
      }
      break;

    case 'eval':
      args.push('eval', input.js);
      break;

    case 'check':
      args.push('check', input.selector);
      break;

    case 'uncheck':
      args.push('uncheck', input.selector);
      break;

    case 'close':
      args.push('close');
      break;
  }

  return args;
}

export async function executeBrowserCommand(
  args: string[],
  timeout: number = BROWSER_DEFAULT_TIMEOUT,
): Promise<{ stdout: string; stderr: string; exitCode: number; durationMs: number }> {
  const start = performance.now();

  try {
    const { stdout, stderr } = await execFileAsync(CLI_BINARY, args, {
      timeout,
      maxBuffer: BROWSER_MAX_BUFFER,
    });

    return {
      stdout: stdout.slice(0, BROWSER_MAX_OUTPUT_LENGTH),
      stderr: stderr.slice(0, BROWSER_MAX_OUTPUT_LENGTH),
      exitCode: 0,
      durationMs: Math.round(performance.now() - start),
    };
  } catch (err: unknown) {
    const durationMs = Math.round(performance.now() - start);
    const execError = err as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      killed?: boolean;
    };

    if (execError.killed) {
      return {
        stdout: (execError.stdout ?? '').slice(0, BROWSER_MAX_OUTPUT_LENGTH),
        stderr: `Command timed out after ${timeout}ms`,
        exitCode: 124,
        durationMs,
      };
    }

    return {
      stdout: (execError.stdout ?? '').slice(0, BROWSER_MAX_OUTPUT_LENGTH),
      stderr: (execError.stderr ?? String(err)).slice(0, BROWSER_MAX_OUTPUT_LENGTH),
      exitCode: typeof execError.code === 'number' ? execError.code : 1,
      durationMs,
    };
  }
}

export function createBrowserTool(config: BrowserConfig = {}) {
  const timeout = config.timeout ?? BROWSER_DEFAULT_TIMEOUT;

  return tool({
    description: BROWSER_TOOL_DESCRIPTION,
    inputSchema: browserInputSchema,
    execute: async (input) => {
      const available = await isBrowserCliAvailable();
      if (!available) {
        return error('agent-browser CLI not found. Install with: npm install -g agent-browser', {
          action: input.action,
          hint: 'The browser tool requires the agent-browser CLI to be installed globally.',
        });
      }

      const args = buildCommand(input, config);
      const result = await executeBrowserCommand(args, timeout);

      if (result.exitCode !== 0) {
        return error(`Browser command failed (exit ${result.exitCode})`, {
          action: input.action,
          stderr: result.stderr,
          stdout: result.stdout,
          durationMs: result.durationMs,
        });
      }

      const output = result.stdout.trim() || result.stderr.trim() || '(no output)';

      return success({
        action: input.action,
        output,
        durationMs: result.durationMs,
      });
    },
  });
}

export const browserTool = createBrowserTool();
