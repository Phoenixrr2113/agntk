/**
 * @agntk/core - Agent Factory
 *
 * A fully-equipped agent that shows up ready. No roles, no tool presets,
 * no feature flags. You give it a name, tell it what it's doing, and
 * point it at a task. It figures out the rest.
 *
 * Every capability is auto-detected from the environment:
 * - Tools: ALL tools, always (plus any custom tools you pass)
 * - Memory: always on, stored at ~/.agntk/agents/{name}/
 * - Durability: auto-detected (workflow package installed → on)
 * - Telemetry: auto-detected (LANGFUSE_PUBLIC_KEY set → on)
 * - Skills: auto-discovered from standard directories
 * - Sub-agents: always enabled with team coordination
 * - Reflection: always on (reflact strategy)
 * - Guardrails: always on (output: PII content filter)
 * - Model: auto-selected from available API keys
 */

import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { ToolLoopAgent, stepCountIs } from 'ai';
import type { ToolSet, TelemetrySettings as AiTelemetrySettings } from 'ai';
import { createLogger } from '@agntk/logger';
import type { AgentOptions, Agent, AgentStreamResult } from './types/agent';
import { usageLimitStop } from './usage-limits';
import { resolveModel } from './models';
import { createToolPreset } from './presets/tools';
import { createSpawnAgentTool } from './tools/spawn-agent';
import { wrapAllToolsWithRetry } from './tools/model-retry';
import {
  discoverSkills,
  filterEligibleSkills,
  buildSkillsSystemPrompt,
  loadSkillContent,
} from './skills';
import { checkWorkflowAvailability } from './workflow/utils';
import { wrapToolsAsDurable } from './workflow/durable-tool';
import { createReflectionPrepareStep } from './reflection';
import { runGuardrails, handleGuardrailResults } from './guardrails/runner';
import { contentFilter } from './guardrails/built-ins';
import type { Guardrail } from './guardrails/types';
import { applyApproval, resolveApprovalConfig } from './tools/approval';
import { MarkdownMemoryStore } from './memory/store';
import { loadMemoryContext } from './memory/loader';
import { createMemoryTools } from './memory/tools';
import { initObservability, createTelemetrySettings } from './observability';
import { buildDynamicSystemPrompt } from './prompts/context';

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('@agntk/core:agent');

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_STEPS = 25;
const SUB_AGENT_MAX_STEPS = 15;
const DEFAULT_MAX_SPAWN_DEPTH = 2;
/** Relative path (from homedir) to the agents state directory. */
export const AGENT_STATE_BASE = '.agntk/agents';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Resolve the persistent state directory for a named agent.
 * ~/.agntk/agents/{name}/
 */
export function resolveAgentStatePath(name: string): string {
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  return resolve(homedir(), AGENT_STATE_BASE, safeName);
}

/**
 * Detect if telemetry should be enabled from env vars.
 */
function detectTelemetry(): boolean {
  return !!(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
}

/**
 * Build the base instructions for the agent.
 */
function buildBaseInstructions(
  name: string,
  userInstructions?: string,
  skillsPrompt?: string,
): string {
  const parts: string[] = [];

  parts.push(`You are ${name}, a capable AI agent.`);

  if (userInstructions) {
    parts.push('');
    parts.push(userInstructions);
  }

  parts.push('');
  parts.push(
    'You have access to a full suite of tools including file operations, ' +
      'shell commands, code search (grep, glob, ast-grep), a browser, ' +
      'deep reasoning, planning, and persistent memory. ' +
      'You can spawn sub-agents for complex tasks that benefit from delegation. ' +
      'Use the remember tool to persist important findings across sessions. ' +
      'Use the recall tool to search your memory for relevant context. ' +
      "If the user's request is vague or conversational (e.g., greetings, " +
      '"whats up", "hello"), respond conversationally without using tools.',
  );

  if (skillsPrompt) {
    parts.push('');
    parts.push(skillsPrompt);
  }

  return parts.join('\n');
}

// ============================================================================
// Internal Options (for sub-agent recursion)
// ============================================================================

/** @internal */
export interface InternalOptions {
  _spawnDepth?: number;
}

// ============================================================================
// Agent Factory
// ============================================================================

/**
 * Create an agent — fully equipped, zero config.
 *
 * @example
 * ```typescript
 * const agent = createAgent({
 *   name: 'deploy-bot',
 *   instructions: 'You manage deployments for our k8s cluster.',
 * });
 *
 * const result = await agent.stream({ prompt: 'Roll back staging to yesterday' });
 * for await (const chunk of result.fullStream) {
 *   if (chunk.type === 'text-delta') process.stdout.write(chunk.text ?? '');
 * }
 * ```
 */
export function createAgent(options: AgentOptions, _internal: InternalOptions = {}): Agent {
  const { name, instructions, workspaceRoot = process.cwd() } = options;

  const spawnDepth = _internal._spawnDepth ?? 0;
  const isSubAgent = spawnDepth > 0;
  const maxSteps = options.maxSteps ?? (isSubAgent ? SUB_AGENT_MAX_STEPS : DEFAULT_MAX_STEPS);

  log.info('Creating agent', { name, maxSteps, workspaceRoot, spawnDepth });

  // ── 1. Resolve model ──────────────────────────────────────────────────
  const model = options.model ?? resolveModel({ tier: 'standard' });
  log.debug('Model resolved', { hasExplicitModel: !!options.model });

  // ── 2. Build ALL tools ────────────────────────────────────────────────
  let tools: ToolSet = createToolPreset('full', { workspaceRoot }) as ToolSet;

  // Merge user-provided tools (escape hatch for testing / custom tools)
  if (options.tools) {
    Object.assign(tools, options.tools);
  }

  log.debug('Base tools built', { count: Object.keys(tools).length });

  // ── 3. Memory — always on ─────────────────────────────────────────────
  const agentStatePath = resolveAgentStatePath(name);
  const memoryStore = new MarkdownMemoryStore({
    projectDir: agentStatePath,
    globalDir: '.agntk',
    workspaceRoot,
  });

  const memoryTools = createMemoryTools({ store: memoryStore, model });
  Object.assign(tools, memoryTools);
  log.info('Memory enabled', { agentStatePath });

  // ── 4. Sub-agents — recursive creation ────────────────────────────────
  if (spawnDepth < DEFAULT_MAX_SPAWN_DEPTH) {
    const spawnTool = createSpawnAgentTool({
      maxSpawnDepth: DEFAULT_MAX_SPAWN_DEPTH,
      currentDepth: spawnDepth,
      createAgent: (subAgentOptions) => {
        const subName = `${name}/${subAgentOptions.role}`;
        log.info('Spawning sub-agent', { parentName: name, subName });

        const subAgent = createAgent(
          {
            name: subName,
            instructions: subAgentOptions.instructions,
            workspaceRoot,
            maxSteps: SUB_AGENT_MAX_STEPS,
            model: options.model,
          },
          {
            _spawnDepth: spawnDepth + 1,
          },
        );

        return {
          stream: (input: { prompt: string }) => {
            const streamPromise = subAgent.stream(input);
            return {
              fullStream: (async function* () {
                const result = await streamPromise;
                for await (const chunk of result.fullStream) {
                  yield chunk;
                }
              })(),
              text: streamPromise.then((r) => r.text),
            };
          },
        };
      },
    });
    tools = { ...tools, spawn_agent: spawnTool };
  }

  // ── 5. ModelRetry — always on ─────────────────────────────────────────
  tools = wrapAllToolsWithRetry(tools, 3) as ToolSet;

  // ── 6. Auto-discover skills ───────────────────────────────────────────
  let skillsPrompt = '';
  try {
    const discovered = discoverSkills(undefined, workspaceRoot);
    const eligible = filterEligibleSkills(discovered);
    if (eligible.length > 0) {
      const loaded = eligible.map((s) => loadSkillContent(s));
      skillsPrompt = buildSkillsSystemPrompt(loaded);
      log.info('Skills discovered', { count: eligible.length });
    }
  } catch (err) {
    log.warn('Skill discovery failed', { error: err instanceof Error ? err.message : String(err) });
  }

  // ── 7. Build system prompt ────────────────────────────────────────────
  let augmentedSystemPrompt = buildBaseInstructions(name, instructions, skillsPrompt);

  // ── 8. Stop conditions ────────────────────────────────────────────────
  const stopConditions: Array<
    (opts: { steps: Array<import('ai').StepResult<ToolSet>> }) => PromiseLike<boolean> | boolean
  > = [stepCountIs(maxSteps)];

  if (options.usageLimits) {
    stopConditions.push(usageLimitStop(options.usageLimits));
  }

  // ── 9. Reflection — always on (reflact strategy) ──────────────────────
  // Pass a getter so reflection always reads the current augmentedSystemPrompt,
  // even after memory/context is injected during ensureInit() (fixes DESIGN-001).
  const prepareStep = createReflectionPrepareStep(() => augmentedSystemPrompt, {
    strategy: 'reflact',
  });

  // ── 10. Guardrails — always on (output: PII content filter) ───────────
  const outputGuardrails: Guardrail[] = [contentFilter()];

  // ── 11. Apply approval wrapping if requested ───────────────────────────
  const approvalConfig = resolveApprovalConfig(options.approval);
  if (approvalConfig) {
    tools = applyApproval(tools, approvalConfig) as ToolSet;
    log.info('Approval system enabled', {
      tools: approvalConfig.tools ?? 'default dangerous tools',
    });
  }

  // ── 12. Telemetry — auto-detect ──────────────────────────────────────
  const telemetryEnabled = detectTelemetry();
  const telemetrySettings = telemetryEnabled
    ? createTelemetrySettings({ functionId: `agent:${name}` })
    : undefined;

  // ── 13. Build the ToolLoopAgent ──────────────────────────────────────
  const toolLoopAgent = new ToolLoopAgent({
    model,
    instructions: augmentedSystemPrompt,
    tools,
    stopWhen: stopConditions,
    prepareCall: (opts) => ({ ...opts, instructions: augmentedSystemPrompt }),
    prepareStep,
    ...(telemetrySettings
      ? { experimental_telemetry: telemetrySettings as AiTelemetrySettings }
      : {}),
  });

  log.debug('ToolLoopAgent created', {
    toolCount: Object.keys(tools).length,
    telemetry: !!telemetrySettings,
  });

  // ── Lazy initializers ─────────────────────────────────────────────────

  const agentLog = log.child({ agent: name });
  let initialized = false;
  let initPromise: Promise<void> | null = null;

  async function ensureInit(): Promise<void> {
    if (initialized) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      try {
        // Load memory context into system prompt
        try {
          const memoryContext = await loadMemoryContext(memoryStore);
          if (memoryContext) {
            augmentedSystemPrompt = memoryContext + '\n\n' + augmentedSystemPrompt;
            agentLog.debug('Memory context injected', { chars: memoryContext.length });
          }
        } catch (err) {
          agentLog.warn('Memory context loading failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        }

        // Inject dynamic environment context
        try {
          augmentedSystemPrompt = await buildDynamicSystemPrompt(augmentedSystemPrompt, {
            workspaceRoot,
            includeWorkspaceMap: true,
          });
        } catch (err) {
          agentLog.warn('Dynamic context injection failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        }

        // Apply durable wrapping if workflow runtime is available
        try {
          const workflowAvailable = await checkWorkflowAvailability();
          if (workflowAvailable) {
            tools = wrapToolsAsDurable(tools, { retryCount: 3 }) as ToolSet;
            agentLog.info('Durable tool wrapping active');
          }
        } catch {
          agentLog.debug('Workflow detection failed — skipping durable wrapping');
        }

        // Initialize telemetry if detected
        if (telemetryEnabled) {
          try {
            await initObservability({ provider: 'langfuse' });
            agentLog.info('Telemetry initialized');
          } catch (err) {
            agentLog.warn('Telemetry initialization failed', {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        initialized = true;
      } catch (err) {
        // E-5: Reset so callers can retry instead of permanently failing
        initPromise = null;
        throw err;
      }
    })();

    return initPromise;
  }

  // ── Build the agent instance ──────────────────────────────────────────

  const agent: Agent = {
    name,

    init: ensureInit,

    getSystemPrompt: () => augmentedSystemPrompt,

    getToolNames: () => Object.keys(tools),

    stream: async (input): Promise<AgentStreamResult> => {
      await ensureInit();
      agentLog.info('stream() called', { promptLength: input.prompt.length });

      const result = await toolLoopAgent.stream({ prompt: input.prompt });

      // Apply output guardrails to the final text
      const guardedText = result.text.then(async (text: string) => {
        if (!text || outputGuardrails.length === 0) return text;

        try {
          const { results, filteredText } = await runGuardrails(outputGuardrails, text, {
            prompt: input.prompt,
            phase: 'output',
          });

          const check = handleGuardrailResults(results, text, filteredText, 'output', 'filter');
          if (check.blocked) {
            agentLog.info('Output guardrails filtered content', {
              guards: results.filter((r) => !r.passed).map((r) => r.name),
            });
            return check.text;
          }
        } catch (err) {
          agentLog.warn('Output guardrails failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        }

        return text;
      });

      return {
        fullStream: result.fullStream,
        text: guardedText,
        usage: result.totalUsage,
      };
    },
  };

  log.info('Agent created', {
    name,
    spawnDepth,
    toolCount: Object.keys(tools).length,
    memoryPath: agentStatePath,
    telemetry: telemetryEnabled,
  });

  return agent;
}

export default createAgent;
