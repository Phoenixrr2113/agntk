/**
 * @fileoverview Tool preset registry for the SDK.
 * Manages built-in and custom tool presets, allowing for flexible tool selection
 * based on predefined configurations like 'minimal', 'standard', or 'full'.
 */
import { createLogger } from '@agntk/logger';
import { getConfig } from '../config';

const log = createLogger('@agntk/core:presets');

export interface ToolPresetDefinition {
  include?: string[];

  exclude?: string[];

  description?: string;
}

const presetRegistry = new Map<string, ToolPresetDefinition>();
let configPresetsLoaded = false;

const BUILT_IN_PRESETS: Record<string, ToolPresetDefinition> = {
  none: {
    include: [],
    description: 'No tools',
  },
  minimal: {
    include: ['glob'],
    description: 'Glob for file search only',
  },
  standard: {
    include: ['glob', 'grep', 'shell', 'web_search', 'plan', 'deep_reasoning'],
    description: 'Glob, grep, shell, web_search, plan, deep_reasoning',
  },
  full: {
    include: [
      'glob',
      'grep',
      'shell',
      'web_search',
      'plan',
      'deep_reasoning',
      'ast_grep_search',
      'ast_grep_replace',
    ],
    description: 'All standard tools plus AST-grep',
  },
  readonly: {
    include: ['glob', 'grep', 'deep_reasoning'],
    exclude: ['shell'],
    description: 'Read-only tools without shell access',
  },
};

export function registerPreset(name: string, definition: ToolPresetDefinition): void {
  log.debug('Registering preset', { name, include: definition.include?.length ?? 0 });
  presetRegistry.set(name, definition);
}

export function getPreset(name: string): ToolPresetDefinition {
  loadConfigPresets();

  if (presetRegistry.has(name)) {
    return presetRegistry.get(name)!;
  }

  if (name in BUILT_IN_PRESETS) {
    return BUILT_IN_PRESETS[name];
  }

  log.warn('Unknown preset, using standard', { preset: name });
  return BUILT_IN_PRESETS.standard;
}

export function getAllPresetNames(): string[] {
  loadConfigPresets();
  const builtIn = Object.keys(BUILT_IN_PRESETS);
  const custom = Array.from(presetRegistry.keys());
  return [...new Set([...builtIn, ...custom])];
}

export function hasPreset(name: string): boolean {
  loadConfigPresets();
  return presetRegistry.has(name) || name in BUILT_IN_PRESETS;
}

function loadConfigPresets(): void {
  if (configPresetsLoaded) return;
  configPresetsLoaded = true;

  const config = getConfig();
  const presets = (config as Record<string, unknown>).toolPresets as
    | Record<string, ToolPresetDefinition>
    | undefined;

  if (!presets) return;

  for (const [name, presetConfig] of Object.entries(presets)) {
    if (!presetConfig) continue;

    log.info('Loading preset from config', { name });
    registerPreset(name, presetConfig);
  }
}

export function resetPresetRegistry(): void {
  presetRegistry.clear();
  configPresetsLoaded = false;
}

export { BUILT_IN_PRESETS };
