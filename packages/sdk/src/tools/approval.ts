import type { Tool, ToolSet } from 'ai';
import { createLogger } from '@agntk/logger';

const log = createLogger('@agntk/core:approval');

export interface ApprovalConfig {
  enabled: boolean;

  tools?: string[];

  timeout?: number;

  timeoutAction?: 'approve' | 'deny';

  handler?: ApprovalHandler;
}

export type ApprovalHandler = (request: ApprovalRequest) => Promise<boolean> | boolean;

export interface ApprovalRequest {
  toolName: string;
  input: unknown;
  toolCallId: string;
}

export const DANGEROUS_TOOLS = new Set([
  'shell',
  'browser',
  'file_write',
  'file_edit',
  'file_create',
]);

export function isDangerousTool(toolName: string, customList?: string[]): boolean {
  if (customList) {
    return customList.includes(toolName);
  }
  return DANGEROUS_TOOLS.has(toolName);
}

export function wrapToolWithApproval<T extends Tool>(
  toolName: string,
  tool: T,
  config: ApprovalConfig,
): T {
  const { handler, timeout, timeoutAction = 'deny' } = config;

  if (handler) {
    const wrappedTool = {
      ...tool,
      needsApproval: async (input: unknown) => {
        const request: ApprovalRequest = {
          toolName,
          input,
          toolCallId: `approval-${Date.now()}`,
        };

        if (timeout) {
          const result = await Promise.race([
            handler(request),
            new Promise<boolean>((resolve) =>
              setTimeout(() => {
                log.warn('Approval timed out', { toolName, timeout, action: timeoutAction });
                resolve(timeoutAction === 'approve');
              }, timeout),
            ),
          ]);
          return result;
        }

        return handler(request);
      },
    };
    return wrappedTool as T;
  }

  return { ...tool, needsApproval: true } as T;
}

export function applyApproval(tools: ToolSet, config: ApprovalConfig): ToolSet {
  if (!config.enabled) return tools;

  const result: ToolSet = {};
  const dangerousList = config.tools;

  for (const [name, tool] of Object.entries(tools)) {
    if (isDangerousTool(name, dangerousList)) {
      log.debug('Applying approval to tool', { tool: name });
      result[name] = wrapToolWithApproval(name, tool, config);
    } else {
      result[name] = tool;
    }
  }

  return result;
}

export function resolveApprovalConfig(
  input: boolean | ApprovalConfig | undefined,
): ApprovalConfig | undefined {
  if (!input) return undefined;
  if (input === true) return { enabled: true };
  return input;
}
