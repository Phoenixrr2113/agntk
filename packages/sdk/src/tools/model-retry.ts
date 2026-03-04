import { createLogger } from '@agntk/logger';

const log = createLogger('@agntk/core:model-retry');

export class ModelRetry extends Error {
  override readonly name = 'ModelRetry';

  constructor(message: string) {
    super(message);
  }
}

const DEFAULT_MAX_RETRIES = 3;

interface ToolLike {
  description?: string;
  inputSchema?: unknown;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  execute?: Function;
  [key: string]: unknown;
}

export function wrapToolWithRetry<T extends ToolLike>(
  toolDef: T,
  maxRetries: number = DEFAULT_MAX_RETRIES,
): T {
  const originalExecute = toolDef.execute;
  if (!originalExecute) return toolDef;

  let retryCount = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrappedExecute = async (...args: any[]): Promise<unknown> => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      const result = await (originalExecute as (...a: unknown[]) => Promise<unknown>)(...args);
      retryCount = 0;
      return result;
    } catch (err) {
      if (err instanceof ModelRetry) {
        retryCount++;
        log.info('ModelRetry caught', {
          message: err.message,
          retryCount,
          maxRetries,
        });

        if (retryCount > maxRetries) {
          retryCount = 0;
          return JSON.stringify({
            success: false,
            error: `Tool failed after ${String(maxRetries)} retries: ${err.message}`,
            retryExhausted: true,
          });
        }

        return JSON.stringify({
          success: false,
          error: err.message,
          retryable: true,
          retriesRemaining: maxRetries - retryCount,
          instruction: `Please retry with corrected parameters. ${err.message}`,
        });
      }

      throw err;
    }
  };

  return {
    ...toolDef,
    execute: wrappedExecute,
  } as T;
}

export function wrapAllToolsWithRetry<T extends Record<string, ToolLike>>(
  tools: T,
  maxRetries: number = DEFAULT_MAX_RETRIES,
): T {
  const wrapped: Record<string, ToolLike> = {};

  for (const [name, toolDef] of Object.entries(tools)) {
    wrapped[name] = wrapToolWithRetry(toolDef, maxRetries);
  }

  return wrapped as T;
}
