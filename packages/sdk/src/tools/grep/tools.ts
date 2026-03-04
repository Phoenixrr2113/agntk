import { tool } from 'ai';
import { z } from 'zod';

import { createLogger } from '@agntk/logger';
import { getToolConfig } from '../../config';
import { runRg } from './cli';
import { formatGrepResult } from './utils';
import { success, error } from '../utils/tool-result';

const log = createLogger('@agntk/core:grep');

function getGrepConfig() {
  const config = getToolConfig<{
    timeout?: number;
    maxContext?: number;
  }>('grep');
  return {
    timeout: config.timeout ?? 60_000,
    maxContext: config.maxContext ?? 10,
  };
}

const grepInputSchema = z.object({
  pattern: z.string().describe('Regex pattern to search for in file contents'),
  include: z.string().optional().describe('File pattern to include (e.g., "*.ts", "*.{js,jsx}")'),
  path: z
    .string()
    .optional()
    .describe('Directory to search in. Defaults to current working directory.'),
  context: z.number().optional().describe('Number of context lines to show around matches'),
  caseSensitive: z
    .boolean()
    .optional()
    .describe('Enable case-sensitive matching (default: smart case)'),
  wholeWord: z.boolean().optional().describe('Match whole words only'),
});

export const grepTool = tool({
  description:
    'Fast content search. ' +
    'Uses ripgrep when available, falls back to grep. ' +
    'Supports regex patterns and file filtering. ' +
    'Returns file paths with line numbers and matching content.',
  inputSchema: grepInputSchema,
  execute: async (args) => {
    const config = getGrepConfig();
    log.debug('grep execute', { pattern: args.pattern, path: args.path, include: args.include });

    try {
      const result = await runRg({
        pattern: args.pattern,
        paths: args.path ? [args.path] : undefined,
        globs: args.include ? [args.include] : undefined,
        context: Math.min(args.context ?? 2, config.maxContext),
        caseSensitive: args.caseSensitive,
        wholeWord: args.wholeWord,
        timeout: config.timeout,
      });

      if (result.error) {
        log.warn('grep error', { pattern: args.pattern, error: result.error });
        return error(result.error);
      }

      const output = formatGrepResult(result);
      log.info('grep complete', {
        pattern: args.pattern,
        matches: result.totalMatches,
        files: result.filesSearched,
      });

      return success({
        output,
        matches: result.matches,
        totalMatches: result.totalMatches,
        filesSearched: result.filesSearched,
        truncated: result.truncated,
      });
    } catch (err: unknown) {
      log.error('grep failed', { pattern: args.pattern, error: err });
      return error(err instanceof Error ? err.message : String(err));
    }
  },
});

export function createGrepTool() {
  return { grep: grepTool };
}
