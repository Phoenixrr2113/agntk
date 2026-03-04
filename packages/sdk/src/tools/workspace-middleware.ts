import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createLogger } from '@agntk/logger';

const log = createLogger('@agntk/core:workspace-middleware');

interface ToolLike {
  description?: string;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  execute?: Function;
  [key: string]: unknown;
}

export interface WorkspaceMiddlewareOptions {
  getWorkspacePath: () => string | null;

  tokenThreshold?: number;

  summaryMaxChars?: number;

  excludeTools?: string[];
}

const CHARS_PER_TOKEN = 4;
const DEFAULT_TOKEN_THRESHOLD = 2000;
const DEFAULT_SUMMARY_MAX_CHARS = 500;
const DEFAULT_EXCLUDE_TOOLS = [
  'plan',
  'deep_reasoning',
  'check_agent',
  'spawn_agent',
  'remember',
  'recall',
  'update_context',
  'forget',
];

function wrapToolWithWorkspace<T extends ToolLike>(
  toolName: string,
  toolDef: T,
  options: WorkspaceMiddlewareOptions,
): T {
  const originalExecute = toolDef.execute;
  if (!originalExecute) return toolDef;

  const tokenThreshold = options.tokenThreshold ?? DEFAULT_TOKEN_THRESHOLD;
  const summaryMaxChars = options.summaryMaxChars ?? DEFAULT_SUMMARY_MAX_CHARS;
  const charThreshold = tokenThreshold * CHARS_PER_TOKEN;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrappedExecute = async (...args: any[]): Promise<unknown> => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const result = await (originalExecute as (...a: unknown[]) => Promise<unknown>)(...args);

    if (typeof result !== 'string') return result;

    if (result.length <= charThreshold) return result;

    const workspacePath = options.getWorkspacePath();
    if (!workspacePath) return result;

    try {
      const hash = simpleHash(result).slice(0, 6);
      const fileName = `${toolName}-${hash}.md`;
      const filePath = join(workspacePath, fileName);

      const dir = dirname(filePath);
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }

      await writeFile(filePath, result, 'utf-8');

      const estimatedTokens = Math.ceil(result.length / CHARS_PER_TOKEN);
      const truncated = result.slice(0, summaryMaxChars);
      const lastNewline = truncated.lastIndexOf('\n');
      const cleanTruncation =
        lastNewline > summaryMaxChars * 0.5 ? truncated.slice(0, lastNewline) : truncated;

      log.info('Tool result offloaded to workspace', {
        tool: toolName,
        tokens: estimatedTokens,
        file: fileName,
      });

      return JSON.stringify({
        _workspaceOffloaded: true,
        savedTo: filePath,
        estimatedTokens,
        summary: cleanTruncation + '\n\n... (truncated)',
        hint: `Full result (${estimatedTokens} tokens) saved to ${filePath}. Read the file for complete output.`,
      });
    } catch (err) {
      log.warn('Workspace offload failed, returning full result', {
        tool: toolName,
        error: err instanceof Error ? err.message : String(err),
      });
      return result;
    }
  };

  return {
    ...toolDef,
    execute: wrappedExecute,
  } as T;
}

export function wrapAllToolsWithWorkspace<T extends Record<string, ToolLike>>(
  tools: T,
  options: WorkspaceMiddlewareOptions,
): T {
  const exclude = new Set(options.excludeTools ?? DEFAULT_EXCLUDE_TOOLS);
  const wrapped: Record<string, ToolLike> = {};

  for (const [name, toolDef] of Object.entries(tools)) {
    if (exclude.has(name)) {
      wrapped[name] = toolDef;
    } else {
      wrapped[name] = wrapToolWithWorkspace(name, toolDef, options);
    }
  }

  return wrapped as T;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < Math.min(str.length, 1000); i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash).toString(36);
}
