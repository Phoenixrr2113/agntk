/**
 * @fileoverview Sub-agent spawning and lifecycle management.
 * Handles creating, executing, and summarizing tasks delegted to sub-agents.
 * Supports both synchronous (blocking) and asynchronous (background) execution.
 */

import { generateId, generateText } from 'ai';
import { z } from 'zod';
import { createLogger } from '@agntk/logger';

import { resolveModel } from '../../models';
import type { AgentRegistry, AgentRegistryEntry, SpawnErrorType } from './registry';

const log = createLogger('@agntk/core:spawn-agent');

export interface SpawnAgentOptions {
  maxSpawnDepth?: number;

  currentDepth?: number;

  createAgent?: (options: {
    task: string;
    instructions: string;
    workspacePath: string;
    model?: 'fast' | 'standard' | 'reasoning';
    tools?: string[];
  }) => {
    stream: (input: { prompt: string }) => {
      fullStream: AsyncIterable<{ type: string; text?: string }>;
      text: Promise<string>;
      usage: Promise<{ totalTokens?: number; promptTokens?: number; completionTokens?: number }>;
    };
  };

  registry?: AgentRegistry;

  workspacePath?: string;

  onStream?: (data: SubAgentStreamData) => void;
}

export interface SubAgentStreamData {
  type: 'sub-agent-stream';
  agentId: string;
  text: string;
  status: 'streaming' | 'complete';
}

const DESCRIPTION = `Spawn a sub-agent to work on a specific task.

Use this tool to delegate work that benefits from:
- Independent, focused execution
- Parallel processing (use async: true)
- Isolated workspace for intermediate results

The sub-agent works autonomously and writes its output to a workspace directory.
You receive a summary and can read the full output from the workspace path.

Parameters:
- task (required): Clear description of what the sub-agent should accomplish
- context: Background information the sub-agent needs
- async: Set to true to run in background (use check_agent to poll)
- model: Override model tier ('fast', 'standard', 'reasoning')

When async is false (default), this tool blocks until the sub-agent completes.
When async is true, it returns immediately with an agentId for polling.`;

export const spawnAgentParametersSchema = z.object({
  task: z.string().describe('Clear description of what the sub-agent should accomplish'),
  context: z.string().optional().describe('Background information the sub-agent needs'),
  async: z
    .boolean()
    .default(false)
    .describe('If true, run in background and return immediately with agentId'),
  model: z
    .enum(['fast', 'standard', 'reasoning'])
    .optional()
    .describe('Model tier override (default: inherit parent)'),
});

export type SpawnAgentInput = z.infer<typeof spawnAgentParametersSchema>;

export interface SpawnAgentSyncResult {
  success: boolean;
  agentId: string;
  summary?: string;
  workspacePath: string;
  error?: string;
  errorType?: SpawnErrorType;
  message?: string;
}

export interface SpawnAgentAsyncResult {
  success: true;
  agentId: string;
  workspacePath: string;
  status: 'running';
  message: string;
}

export type SpawnAgentResult = SpawnAgentSyncResult | SpawnAgentAsyncResult;

export function generateAgentId(task: string): string {
  const slug = task
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .join('-');

  const suffix = generateId().slice(0, 4);
  return `${slug || 'agent'}-${suffix}`;
}

async function executeSpawnAgent(
  input: SpawnAgentInput,
  options: SpawnAgentOptions,
): Promise<SpawnAgentResult> {
  const {
    maxSpawnDepth = 2,
    currentDepth = 0,
    createAgent,
    registry,
    workspacePath,
    onStream,
  } = options;

  const { task, context, model: modelTier } = input;
  const isAsync = input.async;

  if (currentDepth >= maxSpawnDepth) {
    return {
      success: false,
      agentId: '',
      workspacePath: '',
      error: 'Maximum spawn depth reached. Sub-agents cannot spawn further sub-agents.',
      errorType: 'depth_exceeded' as SpawnErrorType,
      message: 'Complete this task directly instead of delegating.',
    };
  }

  if (!createAgent) {
    return {
      success: false,
      agentId: '',
      workspacePath: '',
      error: 'Agent factory not configured. Sub-agent spawning is disabled.',
    };
  }

  const agentId = generateAgentId(task);
  const agentWorkspacePath = workspacePath ? `${workspacePath}/${agentId}` : agentId;

  log.info('Spawning sub-agent', { agentId, task: task.slice(0, 80), async: isAsync });

  const registryEntry: AgentRegistryEntry = {
    agentId,
    task,
    status: 'running',
    workspacePath: agentWorkspacePath,
    startedAt: new Date().toISOString(),
  };

  if (registry) {
    await registry.register(registryEntry);
  }

  const instructions = buildSubAgentInstructions(task, agentWorkspacePath);

  const fullPrompt = context ? `Context:\n${context}\n\nTask:\n${task}` : task;

  const subAgent = createAgent({
    task,
    instructions,
    workspacePath: agentWorkspacePath,
    model: modelTier,
  });

  if (isAsync) {
    runSubAgentInBackground(
      subAgent,
      fullPrompt,
      agentId,
      task,
      agentWorkspacePath,
      registry ?? null,
      onStream ?? null,
    ).catch((err) => {
      log.error('Background sub-agent failed', {
        agentId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    return {
      success: true,
      agentId,
      workspacePath: agentWorkspacePath,
      status: 'running',
      message: `Sub-agent "${agentId}" started in background. Use check_agent to poll status.`,
    };
  }

  return runSubAgentSync(
    subAgent,
    fullPrompt,
    agentId,
    task,
    agentWorkspacePath,
    registry ?? null,
    onStream ?? null,
  );
}

async function runSubAgentSync(
  subAgent: ReturnType<NonNullable<SpawnAgentOptions['createAgent']>>,
  prompt: string,
  agentId: string,
  task: string,
  agentWorkspacePath: string,
  registry: AgentRegistry | null,
  onStream: ((data: SubAgentStreamData) => void) | null,
): Promise<SpawnAgentSyncResult> {
  if (onStream) {
    onStream({ type: 'sub-agent-stream', agentId, text: '', status: 'streaming' });
  }

  try {
    const stream = subAgent.stream({ prompt });

    for await (const chunk of stream.fullStream) {
      if (chunk.type === 'text-delta' && chunk.text) {
        if (onStream) {
          onStream({ type: 'sub-agent-stream', agentId, text: chunk.text, status: 'streaming' });
        }
      }
    }

    const result = await stream.text;

    if (onStream) {
      onStream({ type: 'sub-agent-stream', agentId, text: result, status: 'complete' });
    }

    const summary = await extractSummary(result, task);

    if (registry) {
      await registry.update(agentId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        summary,
      });
    }

    return {
      success: true,
      agentId,
      summary,
      workspacePath: agentWorkspacePath,
      message: `Sub-agent "${agentId}" completed the task. Full output at ${agentWorkspacePath}`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorType = classifyError(error);

    if (onStream) {
      onStream({
        type: 'sub-agent-stream',
        agentId,
        text: `Error: ${errorMessage}`,
        status: 'complete',
      });
    }

    if (registry) {
      await registry.update(agentId, {
        status: 'failed',
        completedAt: new Date().toISOString(),
        error: errorMessage,
        errorType,
      });
    }

    return {
      success: false,
      agentId,
      workspacePath: agentWorkspacePath,
      error: errorMessage,
      errorType,
    };
  }
}

async function runSubAgentInBackground(
  subAgent: ReturnType<NonNullable<SpawnAgentOptions['createAgent']>>,
  prompt: string,
  agentId: string,
  task: string,
  agentWorkspacePath: string,
  registry: AgentRegistry | null,
  onStream: ((data: SubAgentStreamData) => void) | null,
): Promise<void> {
  try {
    const stream = subAgent.stream({ prompt });

    for await (const chunk of stream.fullStream) {
      if (chunk.type === 'text-delta' && chunk.text && onStream) {
        onStream({ type: 'sub-agent-stream', agentId, text: chunk.text, status: 'streaming' });
      }
    }

    const result = await stream.text;

    if (onStream) {
      onStream({ type: 'sub-agent-stream', agentId, text: result, status: 'complete' });
    }

    const summary = await extractSummary(result, task);

    if (registry) {
      await registry.update(agentId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        summary,
      });
    }

    log.info('Background sub-agent completed', { agentId });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorType = classifyError(error);

    if (onStream) {
      onStream({
        type: 'sub-agent-stream',
        agentId,
        text: `Error: ${errorMessage}`,
        status: 'complete',
      });
    }

    if (registry) {
      await registry.update(agentId, {
        status: 'failed',
        completedAt: new Date().toISOString(),
        error: errorMessage,
        errorType,
      });
    }

    log.error('Background sub-agent failed', { agentId, error: errorMessage, errorType });
  }
}

function buildSubAgentInstructions(task: string, workspacePath: string): string {
  return `You are a sub-agent working on a specific task. Focus exclusively on this task and produce thorough results.

Your workspace directory is: ${workspacePath}
Write your output, notes, and intermediate results to this directory.

When you finish:
1. Write a clear summary of what you accomplished
2. Note any issues encountered or decisions made
3. Save detailed results to your workspace directory

Task: ${task}`;
}

async function extractSummary(fullOutput: string, originalTask: string): Promise<string> {
  if (fullOutput.length <= 500) {
    return fullOutput;
  }

  try {
    const { text } = await generateText({
      model: resolveModel({ tier: 'fast' }).model,
      system: `You are summarizing the output of a sub-agent. Write a clear, actionable summary that captures key findings, decisions, and results. Be concise but preserve critical details.`,
      prompt: `Original task: ${originalTask}\n\nSub-agent output:\n${fullOutput}`,
      maxRetries: 1,
    });
    return text;
  } catch {
    return `${fullOutput.slice(0, 500)}...\n[Summary extraction failed, showing first 500 chars]`;
  }
}

function classifyError(error: unknown): SpawnErrorType {
  if (!(error instanceof Error)) return 'task_failed';

  const msg = error.message.toLowerCase();

  if (msg.includes('timeout') || msg.includes('step limit') || msg.includes('max steps')) {
    return 'timeout';
  }

  if (
    msg.includes('rate limit') ||
    msg.includes('401') ||
    msg.includes('403') ||
    msg.includes('429') ||
    msg.includes('api') ||
    msg.includes('network') ||
    msg.includes('fetch failed') ||
    msg.includes('econnrefused')
  ) {
    return 'api_error';
  }

  if (msg.includes('depth') || msg.includes('recursion')) {
    return 'depth_exceeded';
  }

  return 'task_failed';
}

export function createSpawnAgentTool(options: SpawnAgentOptions = {}) {
  return {
    description: DESCRIPTION,
    inputSchema: spawnAgentParametersSchema,
    execute: (input: SpawnAgentInput) => executeSpawnAgent(input, options),
  };
}

export default createSpawnAgentTool;
