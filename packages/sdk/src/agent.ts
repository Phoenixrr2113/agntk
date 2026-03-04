/**
 * @fileoverview Main SDK agent implementation and lifecycle management.
 */
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { ToolLoopAgent, stepCountIs } from 'ai';
import type { ToolSet, TelemetrySettings as AiTelemetrySettings } from 'ai';
import { createLogger } from '@agntk/logger';
import type { AgentOptions, Agent, AgentStreamResult } from './types/agent';
import { usageLimitStop } from './usage-limits';
import { resolveModel } from './models';
import { createToolPreset } from './presets/tools';
import { createSpawnAgentTool } from './tools/spawn-agent';
import { createCheckAgentTool } from './tools/spawn-agent/check-agent';
import { AgentRegistry } from './tools/spawn-agent/registry';
import { wrapAllToolsWithRetry } from './tools/model-retry';
import { wrapAllToolsWithWorkspace } from './tools/workspace-middleware';
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
import { initObservability, createTelemetrySettings } from './observability';
import { buildDynamicSystemPrompt } from './prompts/context';

const log = createLogger('@agntk/core:agent');

const SUB_AGENT_MAX_STEPS = 15;
const DEFAULT_MAX_SPAWN_DEPTH = 2;

export const AGENT_STATE_BASE = '.agntk/agents';

export function resolveAgentStatePath(name: string): string {
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  return resolve(homedir(), AGENT_STATE_BASE, safeName);
}

function detectTelemetry(): boolean {
  return !!(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
}

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
      'deep reasoning, planning, and a persistent workspace. ' +
      'You can spawn sub-agents for complex tasks that benefit from delegation. ' +
      "If the user's request is vague or conversational (e.g., greetings, " +
      '"whats up", "hello"), respond conversationally without using tools.',
  );

  if (skillsPrompt) {
    parts.push('');
    parts.push(skillsPrompt);
  }

  return parts.join('\n');
}

function buildWorkspaceInstructions(store: MarkdownMemoryStore): string {
  const memoryPath = store.getMemoryPath();
  const workspacePath = store.getWorkspacePath();
  const archivePath = store.getArchivePath();

  return `# Agent Workspace

You own a persistent workspace. Use it like a desk:

**${workspacePath}** — your active working area. Each task gets its own folder.
  \`workspace/current\` points to the active task folder (symlink).
  Write notes, intermediate results, drafts here.
  When done, move the task folder to archive/.

**${memoryPath}** — long-term storage. Create files with descriptive names for
  knowledge worth keeping across sessions.
  Name files by topic (e.g. project-setup.md, api-design.md).
  \`decisions.md\` is append-only — log decisions with rationale.
  \`ls memory/\` to see what you already know before creating new files.

**${archivePath}** — completed task folders from workspace/, frozen for reference.
  Use \`grep -r "query" archive/\` to search past work.

**context.md** — session breadcrumbs. At the end of a session, write a brief
  summary of what was accomplished and what's next.

Use your existing file tools (read_file, write_file, glob, grep, shell) to
interact with workspace. No special memory tools needed.`;
}

export interface InternalOptions {
  _spawnDepth?: number;
}

export function createAgent(options: AgentOptions, _internal: InternalOptions = {}): Agent {
  const { name, instructions, workspaceRoot = process.cwd() } = options;

  const spawnDepth = _internal._spawnDepth ?? 0;
  const isSubAgent = spawnDepth > 0;
  const maxSteps = options.maxSteps ?? (isSubAgent ? SUB_AGENT_MAX_STEPS : 0);

  log.info('Creating agent', { name, maxSteps, workspaceRoot, spawnDepth });

  const resolved = options.model ? null : resolveModel({ tier: 'standard' });
  const model = options.model ?? resolved!.model;
  const modelId = resolved?.modelId ?? 'custom';
  log.debug('Model resolved', { hasExplicitModel: !!options.model, modelId });

  const agentStatePath = resolveAgentStatePath(name);
  let tools: ToolSet = createToolPreset('full', {
    workspaceRoot,
    fileOptions: { allowedPaths: [agentStatePath] },
  }) as ToolSet;

  if (options.tools) {
    Object.assign(tools, options.tools);
  }

  log.debug('Base tools built', { count: Object.keys(tools).length });

  const memoryStore = new MarkdownMemoryStore({
    projectDir: agentStatePath,
    globalDir: '.agntk',
    workspaceRoot,
  });

  let currentWorkspacePath: string | null = null;

  tools = wrapAllToolsWithWorkspace(tools, {
    getWorkspacePath: () => currentWorkspacePath,
  }) as ToolSet;

  log.info('Workspace enabled', { agentStatePath });

  const agentRegistry = new AgentRegistry();
  const registryPath = join(agentStatePath, 'registry.json');
  agentRegistry.setPersistPath(registryPath);

  if (spawnDepth < DEFAULT_MAX_SPAWN_DEPTH) {
    const spawnTool = createSpawnAgentTool({
      maxSpawnDepth: DEFAULT_MAX_SPAWN_DEPTH,
      currentDepth: spawnDepth,
      registry: agentRegistry,
      workspacePath: undefined,
      onActivity: options.onSubAgentActivity,
      createAgent: (subAgentOptions) => {
        const subName = `${name}/${subAgentOptions.task.slice(0, 30).replace(/[^a-zA-Z0-9-]/g, '-')}`;
        log.info('Spawning sub-agent', { parentName: name, subName });

        const subResolved = subAgentOptions.model
          ? resolveModel({ tier: subAgentOptions.model })
          : null;
        const subModel = subResolved?.model ?? options.model;

        const subAgent = createAgent(
          {
            name: subName,
            instructions: subAgentOptions.instructions,
            workspaceRoot,
            maxSteps: SUB_AGENT_MAX_STEPS,
            model: subModel,
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
              usage: streamPromise.then((r) => r.usage),
            };
          },
        };
      },
    });
    tools = { ...tools, spawn_agent: spawnTool };

    const checkTool = createCheckAgentTool({ registry: agentRegistry });
    tools = { ...tools, check_agent: checkTool };
  }

  tools = wrapAllToolsWithRetry(tools, 3) as ToolSet;

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

  let augmentedSystemPrompt = buildBaseInstructions(name, instructions, skillsPrompt);

  const stopConditions: Array<
    (opts: { steps: Array<import('ai').StepResult<ToolSet>> }) => PromiseLike<boolean> | boolean
  > = [];

  if (maxSteps && maxSteps > 0) {
    stopConditions.push(stepCountIs(maxSteps));
  }

  const effectiveLimits = options.usageLimits ?? { maxInputTokens: 4_000_000 };
  stopConditions.push(usageLimitStop(effectiveLimits));

  const prepareStep = createReflectionPrepareStep(() => augmentedSystemPrompt, {
    strategy: 'reflact',
  });

  const outputGuardrails: Guardrail[] = [contentFilter()];

  const approvalConfig = resolveApprovalConfig(options.approval);
  if (approvalConfig) {
    tools = applyApproval(tools, approvalConfig) as ToolSet;
    log.info('Approval system enabled', {
      tools: approvalConfig.tools ?? 'default dangerous tools',
    });
  }

  const telemetryEnabled = detectTelemetry();
  const telemetrySettings = telemetryEnabled
    ? createTelemetrySettings({ functionId: `agent:${name}` })
    : undefined;

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

  const agentLog = log.child({ agent: name });
  let initialized = false;
  let initPromise: Promise<void> | null = null;

  async function ensureInit(): Promise<void> {
    if (initialized) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      try {
        try {
          await memoryStore.ensureDirectories();
          agentLog.debug('Workspace directories ensured');
        } catch (err) {
          agentLog.warn('Directory creation failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        }

        try {
          currentWorkspacePath = await memoryStore.getCurrentTaskPath();
          agentLog.debug('Workspace path resolved', { currentWorkspacePath });
        } catch {
          void 0;
        }

        try {
          await agentRegistry.loadFromDisk(registryPath);
        } catch {
          void 0;
        }

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

        try {
          const workspaceInstructions = buildWorkspaceInstructions(memoryStore);
          augmentedSystemPrompt = augmentedSystemPrompt + '\n\n' + workspaceInstructions;
          agentLog.debug('Workspace instructions injected');
        } catch (err) {
          agentLog.warn('Workspace instructions failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        }

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

        try {
          const workflowAvailable = await checkWorkflowAvailability();
          if (workflowAvailable) {
            tools = wrapToolsAsDurable(tools, { retryCount: 3 }) as ToolSet;
            agentLog.info('Durable tool wrapping active');
          }
        } catch {
          agentLog.debug('Workflow detection failed — skipping durable wrapping');
        }

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
        initPromise = null;
        throw err;
      }
    })();

    return initPromise;
  }

  const agent: Agent = {
    name,

    init: ensureInit,

    getSystemPrompt: () => augmentedSystemPrompt,

    getToolNames: () => Object.keys(tools),

    getModelId: () => modelId,

    stream: async (input): Promise<AgentStreamResult> => {
      await ensureInit();
      agentLog.info('stream() called', { promptLength: input.prompt.length });

      const result = await toolLoopAgent.stream({ prompt: input.prompt });

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
    workspacePath: agentStatePath,
    telemetry: telemetryEnabled,
  });

  return agent;
}

export default createAgent;
