/**
 * @fileoverview Tool preset definitions for the SDK.
 * Provides factories and configurations for grouping tools into functional sets
 * such as 'minimal', 'standard', and 'full'.
 */
import { createGlobTool } from '../tools/glob';
import { createGrepTool } from '../tools/grep';
import { createAstGrepTools } from '../tools/ast-grep';
import { createShellTool, createBackgroundTool } from '../tools/shell';
import { createPlanTool, type PlanToolConfig } from '../tools/plan';
import { createDeepReasoningTool } from '../tools/deep-reasoning';
import { createBrowserTool } from '../tools/browser';
import { createFileTools, type FileToolOptions } from '../tools/file';
import { createProgressTools } from '../tools/progress';
import { createSearchSkillsTool } from '../tools/search-skills';
import { createWebSearchTool } from '../tools/web-search';

export type ToolPresetLevel = 'none' | 'minimal' | 'standard' | 'full';

export interface ToolPresetOptions {
  workspaceRoot?: string;

  planConfig?: PlanToolConfig;

  customTools?: Record<string, unknown>;

  fileOptions?: FileToolOptions;
}

export function createToolPreset(preset: ToolPresetLevel, options: ToolPresetOptions = {}) {
  const { workspaceRoot = process.cwd(), planConfig, customTools = {}, fileOptions } = options;

  switch (preset) {
    case 'none':
      return { ...customTools };

    case 'minimal':
      return {
        ...createMinimalPreset(),
        ...customTools,
      };

    case 'standard':
      return {
        ...createStandardPreset(workspaceRoot, planConfig, fileOptions),
        ...customTools,
      };

    case 'full':
      return {
        ...createFullPreset(workspaceRoot, planConfig, fileOptions),
        ...customTools,
      };

    default:
      throw new Error(`Unknown tool preset: ${preset}`);
  }
}

function createMinimalPreset() {
  return createGlobTool();
}

function createStandardPreset(
  workspaceRoot: string,
  planConfig?: PlanToolConfig,
  fileOptions?: FileToolOptions,
) {
  const shell = createShellTool(workspaceRoot);
  const plan = createPlanTool(planConfig ?? {});
  const deep_reasoning = createDeepReasoningTool();

  return {
    ...createGlobTool(),
    ...createGrepTool(),
    ...createFileTools(workspaceRoot, fileOptions),
    ...createSearchSkillsTool(),
    ...createWebSearchTool(),
    shell,
    background: createBackgroundTool(),
    plan,
    deep_reasoning,
  };
}

function createFullPreset(
  workspaceRoot: string,
  planConfig?: PlanToolConfig,
  fileOptions?: FileToolOptions,
) {
  return {
    ...createStandardPreset(workspaceRoot, planConfig, fileOptions),
    ...createAstGrepTools(),
    ...createProgressTools(workspaceRoot),
    browser: createBrowserTool(),
  };
}

export const toolPresets = {
  none: {} as Record<string, never>,

  minimal: {
    description: 'Glob file search only',
    tools: ['glob'],
  },

  standard: {
    description:
      'Glob, grep, shell, background, file tools, search_skills, web_search, plan, deep_reasoning',
    tools: [
      'glob',
      'grep',
      'shell',
      'background',
      'file_read',
      'file_write',
      'file_edit',
      'file_create',
      'search_skills',
      'web_search',
      'plan',
      'deep_reasoning',
    ],
  },

  full: {
    description: 'All standard tools plus AST-grep, progress tracking, and browser automation',
    tools: [
      'glob',
      'grep',
      'shell',
      'background',
      'file_read',
      'file_write',
      'file_edit',
      'file_create',
      'progress_read',
      'progress_update',
      'search_skills',
      'web_search',
      'plan',
      'deep_reasoning',
      'ast_grep_search',
      'ast_grep_replace',
      'browser',
    ],
  },
} as const;
