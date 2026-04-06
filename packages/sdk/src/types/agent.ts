import type { LanguageModel, LanguageModelUsage, Tool } from 'ai';
import type { UsageLimits } from '../usage-limits';
import type { ApprovalConfig } from '../tools/approval';
import type { SubAgentActivityHandler } from '../tools/spawn-agent';
import type { HarnessConfig } from '../harness/types';

export interface AgentOptions {
  name: string;

  instructions?: string;

  workspaceRoot?: string;

  model?: LanguageModel;

  maxSteps?: number;

  usageLimits?: UsageLimits;

  tools?: Record<string, Tool>;

  approval?: boolean | ApprovalConfig;

  onSubAgentActivity?: SubAgentActivityHandler;

  harness?: HarnessConfig;
}

export interface Agent {
  readonly name: string;

  init(): Promise<void>;

  stream(input: { prompt: string }): Promise<AgentStreamResult>;

  getSystemPrompt(): string;

  getToolNames(): string[];

  getModelId(): string;
}

export interface AgentStreamResult {
  fullStream: AsyncIterable<{ type: string; text?: string; [key: string]: unknown }>;

  text: PromiseLike<string>;

  usage: PromiseLike<LanguageModelUsage>;
}
