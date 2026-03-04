/**
 * @fileoverview Tool execution error handling.
 * Provides specialized error classes and types for common tool failures.
 */

export enum ToolErrorType {
  COMMAND_BLOCKED = 'COMMAND_BLOCKED',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  EXECUTION_FAILED = 'EXECUTION_FAILED',
  TIMEOUT = 'TIMEOUT',
  NOT_FOUND = 'NOT_FOUND',
}

export class ToolError extends Error {
  constructor(
    message: string,
    public readonly type: ToolErrorType,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ToolError';
  }

  toJSON() {
    return {
      error: this.type,
      message: this.message,
      context: this.context,
    };
  }
}
