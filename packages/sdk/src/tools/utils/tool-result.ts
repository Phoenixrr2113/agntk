/**
 * Creates a success result object and returns it as a JSON string.
 * @param data - Optional data to include in the result.
 * @param message - Optional message to include in the result.
 * @returns A JSON string representing the success result.
 */
export function success<T extends Record<string, unknown>>(data?: T, message?: string): string {
  const result: { success: true; data?: T; message?: string } = { success: true };
  if (data) {
    Object.assign(result, data);
  }
  if (message) {
    result.message = message;
  }
  return JSON.stringify(result);
}

/**
 * Creates an error result object and returns it as a JSON string.
 * @param err - The error message or Error object.
 * @param context - Optional additional context to include in the result.
 * @returns A JSON string representing the error result.
 */
export function error(err: Error | string, context?: Record<string, unknown>): string {
  const message = err instanceof Error ? err.message : err;
  const result: { success: false; error: string; context?: Record<string, unknown> } = {
    success: false,
    error: message,
  };
  if (context) {
    Object.assign(result, context);
  }
  return JSON.stringify(result);
}
