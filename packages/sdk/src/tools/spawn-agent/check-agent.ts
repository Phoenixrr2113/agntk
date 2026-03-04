/**
 * @fileoverview Sub-agent status tracking tool.
 * Provides functionality to poll, filter, and summarize the status of spawned agents.
 */

import { z } from 'zod';
import type { AgentRegistry, AgentStatus } from './registry';

export interface CheckAgentOptions {
  registry: AgentRegistry;
}

export interface CheckAgentResult {
  agents: CheckAgentEntry[];
  summary: string;
}

export interface CheckAgentEntry {
  agentId: string;
  task: string;
  status: AgentStatus;
  workspacePath: string;
  summary?: string;
  error?: string;
  errorType?: string;
  duration?: string;
}

const DESCRIPTION = `Check the status of spawned sub-agents.

Use this tool to:
- Poll async sub-agents for completion
- See what all sub-agents produced
- Check for errors or failures

Without parameters, returns all agents. Use agentId to check a specific one,
or status to filter (e.g., only 'running' agents).`;

export const checkAgentParametersSchema = z.object({
  agentId: z.string().optional().describe('Check a specific agent by ID'),
  status: z.enum(['running', 'completed', 'failed']).optional().describe('Filter agents by status'),
});

export type CheckAgentInput = z.infer<typeof checkAgentParametersSchema>;

function calcDuration(startedAt: string, completedAt?: string): string {
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const seconds = Math.round((end - start) / 1000);

  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function executeCheckAgent(input: CheckAgentInput, options: CheckAgentOptions): CheckAgentResult {
  const { registry } = options;
  const { agentId, status } = input;

  if (agentId) {
    const entry = registry.get(agentId);
    if (!entry) {
      return {
        agents: [],
        summary: `No agent found with ID "${agentId}".`,
      };
    }

    const agent: CheckAgentEntry = {
      agentId: entry.agentId,
      task: entry.task,
      status: entry.status,
      workspacePath: entry.workspacePath,
      summary: entry.summary,
      error: entry.error,
      errorType: entry.errorType,
      duration: calcDuration(entry.startedAt, entry.completedAt),
    };

    return {
      agents: [agent],
      summary: `Agent "${agentId}": ${entry.status}`,
    };
  }

  const entries = registry.getAll(status as AgentStatus | undefined);
  const agents: CheckAgentEntry[] = entries.map((entry) => ({
    agentId: entry.agentId,
    task: entry.task,
    status: entry.status,
    workspacePath: entry.workspacePath,
    summary: entry.summary,
    error: entry.error,
    errorType: entry.errorType,
    duration: calcDuration(entry.startedAt, entry.completedAt),
  }));

  const counts = registry.getCounts();
  const parts: string[] = [];
  if (counts.running > 0) parts.push(`${counts.running} running`);
  if (counts.completed > 0) parts.push(`${counts.completed} completed`);
  if (counts.failed > 0) parts.push(`${counts.failed} failed`);

  const summary =
    parts.length > 0 ? `${agents.length} agent(s): ${parts.join(', ')}` : 'No agents spawned yet.';

  return { agents, summary };
}

export function createCheckAgentTool(options: CheckAgentOptions) {
  return {
    description: DESCRIPTION,
    inputSchema: checkAgentParametersSchema,
    execute: (input: CheckAgentInput) => executeCheckAgent(input, options),
  };
}
