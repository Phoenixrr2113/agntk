import { tool } from 'ai';
import { z } from 'zod';

import { createLogger } from '@agntk/logger';
import { getToolConfig } from '../../config';
import { runRgFiles } from './cli';
import { formatGlobResult } from './utils';
import { success, error } from '../utils/tool-result';

const log = createLogger('@agntk/core:glob');

function getGlobConfig() {
  const config = getToolConfig<{
    timeout?: number;
    maxFiles?: number;
    maxDepth?: number;
  }>('glob');
  return {
    timeout: config.timeout ?? 60_000,
    maxFiles: config.maxFiles ?? 100,
    maxDepth: config.maxDepth ?? 20,
  };
}

const globInputSchema = z.object({
  pattern: z.string().describe('Glob pattern to match files (e.g., "**/*.ts", "*.json")'),
  path: z
    .string()
    .optional()
    .describe('Directory to search in. Defaults to current working directory.'),
  maxDepth: z.number().optional().describe('Maximum directory depth to search'),
  hidden: z.boolean().optional().describe('Include hidden files and directories'),
});

export const globTool = tool({
  description:
    'Fast file pattern matching. ' +
    'Supports glob patterns like "**/*.js" or "src/**/*.ts". ' +
    'Returns matching file paths sorted by modification time. ' +
    'Automatically excludes node_modules, .git, dist, .turbo, .next, .cache, and coverage. ' +
    'Use maxDepth=1 to list only immediate directory contents.',
  inputSchema: globInputSchema,
  execute: async (args) => {
    const config = getGlobConfig();
    log.debug('glob execute', { pattern: args.pattern, path: args.path, config });

    try {
      const result = await runRgFiles({
        pattern: args.pattern,
        paths: args.path ? [args.path] : undefined,
        maxDepth: args.maxDepth ?? config.maxDepth,
        hidden: args.hidden,
        timeout: config.timeout,
        limit: config.maxFiles,
      });

      if (result.error) {
        log.warn('glob error', { pattern: args.pattern, error: result.error });
        return error(result.error);
      }

      const output = formatGlobResult(result);
      log.info('glob complete', {
        pattern: args.pattern,
        files: result.totalFiles,
        truncated: result.truncated,
      });

      return success({
        output,
        files: result.files.map((f) => f.path),
        count: result.totalFiles,
        truncated: result.truncated,
      });
    } catch (err: unknown) {
      log.error('glob failed', { pattern: args.pattern, error: err });
      return error(err instanceof Error ? err.message : String(err));
    }
  },
});

export function createGlobTool() {
  return { glob: globTool };
}
