export interface StreamWriter {
  write(data: unknown): void;
  writeData?(data: unknown): void;
}

export interface ToolLifecycle<TInput, TOutput> {
  beforeExecute?: (input: TInput, ctx: ToolContext) => Promise<TInput> | TInput;

  validate?: (input: TInput, ctx: ToolContext) => Promise<ValidationResult> | ValidationResult;

  afterExecute?: (input: TInput, output: TOutput, ctx: ToolContext) => Promise<TOutput> | TOutput;

  onError?: (
    error: ToolError,
    input: TInput,
    ctx: ToolContext,
  ) => Promise<TOutput | 'throw'> | TOutput | 'throw';

  cleanup?: (input: TInput, didSucceed: boolean, ctx: ToolContext) => Promise<void> | void;

  onStream?: (data: unknown, ctx: ToolContext) => void;

  shouldBypass?: (
    input: TInput,
    ctx: ToolContext,
  ) => Promise<BypassResult<TOutput>> | BypassResult<TOutput>;

  durability?: DurabilityConfig;
}

export interface ToolContext {
  writer?: StreamWriter;

  agentId: string;

  stepNumber: number;

  parentAgentId?: string;

  workflowRunId?: string;

  workspaceRoot?: string;

  metadata?: Record<string, unknown>;
}

export interface ValidationResult {
  valid: boolean;

  error?: string;

  errorType?: ToolErrorType;
}

export interface BypassResult<TOutput> {
  bypass: boolean;

  result?: TOutput;

  reason?: string;
}

export interface DurabilityConfig {
  enabled: boolean;

  independent: boolean;

  retryCount?: number;

  timeout?: string;

  stepName?: string;
}

export enum ToolErrorType {
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',

  PATH_NOT_IN_WORKSPACE = 'PATH_NOT_IN_WORKSPACE',

  PATH_IS_NOT_A_DIRECTORY = 'PATH_IS_NOT_A_DIRECTORY',

  PATH_IS_NOT_A_FILE = 'PATH_IS_NOT_A_FILE',

  PERMISSION_DENIED = 'PERMISSION_DENIED',

  TIMEOUT = 'TIMEOUT',

  INVALID_INPUT = 'INVALID_INPUT',

  COMMAND_BLOCKED = 'COMMAND_BLOCKED',

  CONTENT_TOO_LARGE = 'CONTENT_TOO_LARGE',

  OPERATION_FAILED = 'OPERATION_FAILED',

  NETWORK_ERROR = 'NETWORK_ERROR',

  RATE_LIMITED = 'RATE_LIMITED',
}

export class ToolError extends Error {
  public readonly type: ToolErrorType;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, type: ToolErrorType, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ToolError';
    this.type = type;
    this.details = details;
  }

  toJSON(): Record<string, unknown> {
    return {
      success: false,
      error: this.message,
      errorType: this.type,
      ...this.details,
    };
  }

  static fileNotFound(path: string): ToolError {
    return new ToolError(`File not found: ${path}`, ToolErrorType.FILE_NOT_FOUND, { path });
  }

  static pathNotInWorkspace(path: string, workspaceRoot: string): ToolError {
    return new ToolError(
      `Path is outside workspace: ${path}`,
      ToolErrorType.PATH_NOT_IN_WORKSPACE,
      { path, workspaceRoot },
    );
  }

  static invalidInput(message: string, details?: Record<string, unknown>): ToolError {
    return new ToolError(message, ToolErrorType.INVALID_INPUT, details);
  }

  static timeout(operation: string, timeoutMs: number): ToolError {
    return new ToolError(`Operation timed out: ${operation}`, ToolErrorType.TIMEOUT, {
      operation,
      timeoutMs,
    });
  }
}

import type { z } from 'zod';

export interface LifecycleToolConfig<TSchema extends z.ZodType, TOutput> {
  name: string;

  description: string;

  inputSchema: TSchema;

  lifecycle: ToolLifecycle<z.infer<TSchema>, TOutput> & {
    execute: (input: z.infer<TSchema>, ctx: ToolContext) => Promise<TOutput>;
  };
}

export type ToolExecuteFn<TInput, TOutput> = (input: TInput, ctx: ToolContext) => Promise<TOutput>;

export type InferToolInput<T> =
  T extends LifecycleToolConfig<infer TSchema, unknown> ? z.infer<TSchema> : never;

export type InferToolOutput<T> =
  T extends LifecycleToolConfig<z.ZodType, infer TOutput> ? TOutput : never;
