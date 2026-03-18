import type { Tool, ToolExecutionOptions } from 'ai';
import { createLogger } from '@agntk/logger';

const log = createLogger('@agntk/core:workflow:tool');

type ToolSet = Record<string, Tool>;

export interface DurabilityConfig {
  enabled?: boolean;

  independent?: boolean;

  retryCount?: number;

  timeout?: string;

  stepName?: string;
}

export function wrapToolAsDurableStep(
  tool: Tool,
  config: DurabilityConfig = {},
  toolName?: string,
): Tool {
  const { enabled = true } = config;

  if (!enabled) {
    return tool;
  }

  const originalExecute = tool.execute;
  if (!originalExecute) {
    return tool;
  }

  const stepName = config.stepName ?? (toolName ? `tool-exec-${toolName}` : 'tool-exec');

  const wrappedTool = {
    ...tool,
    execute: async (input: unknown, options: ToolExecutionOptions) => {
      'use step';

      log.debug(`Executing durable step: ${stepName}`, {
        stepName,
        retryCount: config.retryCount,
        timeout: config.timeout,
      });

      try {
        const result = await originalExecute(input, options);
        log.debug(`Durable step completed: ${stepName}`);
        return result;
      } catch (error) {
        log.error(`Durable step failed: ${stepName}`, {
          error: error instanceof Error ? error.message : String(error),
        });

        throw error;
      }
    },
  } as Tool;

  setDurabilityConfig(wrappedTool, { ...config, stepName });

  return wrappedTool;
}

export function wrapToolsAsDurable(tools: ToolSet, config: DurabilityConfig = {}): ToolSet {
  log.debug('Wrapping all tools as durable', { count: Object.keys(tools).length });

  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => [name, wrapToolAsDurableStep(tool, config, name)]),
  );
}

export function wrapSelectedToolsAsDurable(
  tools: ToolSet,
  toolNames: string[],
  config: DurabilityConfig = {},
): ToolSet {
  const nameSet = new Set(toolNames);
  log.debug('Selectively wrapping tools as durable', {
    total: Object.keys(tools).length,
    selected: toolNames,
  });

  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => [
      name,
      nameSet.has(name) ? wrapToolAsDurableStep(tool, config, name) : tool,
    ]),
  );
}

export function wrapToolAsIndependentStep(tool: Tool, toolName?: string): Tool {
  return wrapToolAsDurableStep(tool, { independent: true }, toolName);
}

export const DURABILITY_CONFIG = Symbol('durabilityConfig');

export function getDurabilityConfig(tool: Tool): DurabilityConfig | undefined {
  return (tool as Record<symbol, unknown>)[DURABILITY_CONFIG] as DurabilityConfig | undefined;
}

export function setDurabilityConfig(tool: Tool, config: DurabilityConfig): Tool {
  (tool as Record<symbol, unknown>)[DURABILITY_CONFIG] = config;
  return tool;
}

export function getStepName(tool: Tool): string | undefined {
  return getDurabilityConfig(tool)?.stepName;
}
