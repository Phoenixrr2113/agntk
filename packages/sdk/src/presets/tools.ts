/**
 * @fileoverview Tool preset definitions for the SDK.
 * Provides factories and configurations for grouping tools into functional sets
 * such as 'minimal', 'standard', and 'full'.
 */
import { createGlobTool } from '../tools/glob';
import { createGrepTool } from '../tools/grep';
import { createAstGrepTools } from '../tools/ast-grep';
import { createShellTool, createBackgroundTool } from '../tools/shell';
import { createBrowserTool } from '../tools/browser';
import { createFileTools, type FileToolOptions } from '../tools/file';
import { createProgressTools } from '../tools/progress';
import { createSearchSkillsTool } from '../tools/search-skills';
import { createWebSearchTool } from '../tools/web-search';

export type ToolPresetLevel = 'none' | 'minimal' | 'standard' | 'full';

export interface ToolPresetOptions {
  workspaceRoot?: string;

  customTools?: Record<string, unknown>;

  fileOptions?: FileToolOptions;
}

export function createToolPreset(preset: ToolPresetLevel, options: ToolPresetOptions = {}) {
  const { workspaceRoot = process.cwd(), customTools = {}, fileOptions } = options;

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
        ...createStandardPreset(workspaceRoot, fileOptions),
        ...customTools,
      };

    case 'full':
      return {
        ...createFullPreset(workspaceRoot, fileOptions),
        ...customTools,
      };

    default:
      throw new Error(
        `[agntk] Unknown tool preset: "${preset}". Valid presets are: none, minimal, standard, full.`,
      );
  }
}

function createMinimalPreset() {
  return createGlobTool();
}

function createStandardPreset(workspaceRoot: string, fileOptions?: FileToolOptions) {
  const shell = createShellTool(workspaceRoot);

  return {
    ...createGlobTool(),
    ...createGrepTool(),
    ...createFileTools(workspaceRoot, fileOptions),
    ...createSearchSkillsTool(),
    ...createWebSearchTool(),
    shell,
    background: createBackgroundTool(),
  };
}

function createFullPreset(workspaceRoot: string, fileOptions?: FileToolOptions) {
  return {
    ...createStandardPreset(workspaceRoot, fileOptions),
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
    description: 'Glob, grep, shell, background, file tools, search_skills, web_search',
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
      'ast_grep_search',
      'ast_grep_replace',
      'browser',
    ],
  },
} as const;
