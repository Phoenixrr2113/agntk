import { existsSync, readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { createLogger } from '@agntk/logger';
import { PartialAgentConfigSchema, type AgentConfig, type PartialAgentConfig } from './schema';
import { DEFAULT_MODELS, DEFAULT_PROVIDER, DEFAULT_MAX_STEPS } from './defaults';
import type { ModelTier, Provider } from './schema';

const log = createLogger('@agntk/core:config');

const configCache = new Map<string, AgentConfig>();

const CONFIG_FILENAMES = [
  'agent-sdk.config.yaml',
  'agent-sdk.config.yml',
  'agent-sdk.config.json',
  '.agent-sdk.yaml',
  '.agent-sdk.json',
];

function findConfigFile(searchDir: string = process.cwd()): string | null {
  const envPath = process.env['AGENT_SDK_CONFIG'];
  if (envPath) {
    const resolved = resolve(searchDir, envPath);
    if (existsSync(resolved)) {
      log.debug('Using config from AGENT_SDK_CONFIG', { path: resolved });
      return resolved;
    }
    log.warn('AGENT_SDK_CONFIG path not found', { path: resolved });
  }

  for (const filename of CONFIG_FILENAMES) {
    const path = resolve(searchDir, filename);
    if (existsSync(path)) {
      log.debug('Found config file', { path });
      return path;
    }
  }

  return null;
}

function parseConfigFile(path: string): PartialAgentConfig {
  const content = readFileSync(path, 'utf-8');
  const ext = extname(path).toLowerCase();

  let parsed: unknown;
  if (ext === '.yaml' || ext === '.yml') {
    parsed = parseYaml(content);
  } else {
    parsed = JSON.parse(content);
  }

  const result = PartialAgentConfigSchema.safeParse(parsed);
  if (!result.success) {
    log.error('Invalid config file', { path, errors: result.error.issues });
    const firstIssue = result.error.issues?.[0];
    const location = firstIssue?.path?.length ? ` at "${firstIssue.path.join('.')}"` : '';
    throw new Error(
      `[agntk] Invalid config file: ${path}\n` +
        `  First error${location}: ${firstIssue?.message ?? result.error.message}\n` +
        `  Fix your agent-sdk.config.yaml or run with AGENT_SDK_CONFIG to use a different path.`,
    );
  }

  return result.data;
}

function getEnvConfig(): PartialAgentConfig {
  const config: PartialAgentConfig = {};

  const tiers: Record<string, string> = {};
  const tierNames = ['fast', 'standard', 'reasoning', 'powerful'] as const;

  for (const tier of tierNames) {
    const envKey = `AGENT_SDK_MODEL_${tier.toUpperCase()}`;
    const value = process.env[envKey];
    if (value) {
      log.debug('Model override from env', { tier, model: value });
      tiers[tier] = value;
    }
  }

  if (Object.keys(tiers).length > 0) {
    config.models = { tiers };
  }

  const provider = process.env['AGENT_SDK_DEFAULT_PROVIDER'];
  if (provider) {
    config.models = { ...config.models, defaultProvider: provider as Provider };
  }

  if (process.env['AGENT_SDK_WORKSPACE']) {
    config.workspaceRoot = process.env['AGENT_SDK_WORKSPACE'];
  }

  if (process.env['AGENT_SDK_MAX_STEPS']) {
    config.maxSteps = parseInt(process.env['AGENT_SDK_MAX_STEPS'], 10);
  }

  return config;
}

function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceValue = source[key];
    const targetValue = result[key];

    if (sourceValue !== undefined) {
      if (
        typeof sourceValue === 'object' &&
        sourceValue !== null &&
        !Array.isArray(sourceValue) &&
        typeof targetValue === 'object' &&
        targetValue !== null &&
        !Array.isArray(targetValue)
      ) {
        result[key] = deepMerge(
          targetValue as Record<string, unknown>,
          sourceValue as Record<string, unknown>,
        ) as T[keyof T];
      } else {
        result[key] = sourceValue as T[keyof T];
      }
    }
  }

  return result;
}

export function loadConfig(searchDir: string = process.cwd()): AgentConfig {
  log.debug('Loading config', { searchDir });

  let config: AgentConfig = {
    models: {
      defaultProvider: DEFAULT_PROVIDER,
      providers: DEFAULT_MODELS,
    },
    maxSteps: DEFAULT_MAX_STEPS,
  };

  const configPath = findConfigFile(searchDir);
  if (configPath) {
    log.info('Loading config file', { path: configPath });
    const fileConfig = parseConfigFile(configPath);
    config = deepMerge(config, fileConfig);
  }

  const envConfig = getEnvConfig();
  config = deepMerge(config, envConfig);

  return config;
}

export function getConfig(searchDir: string = process.cwd()): AgentConfig {
  const key = resolve(searchDir);
  if (!configCache.has(key)) {
    configCache.set(key, loadConfig(searchDir));
  }
  return configCache.get(key)!;
}

export function configure(options: PartialAgentConfig, searchDir: string = process.cwd()): void {
  const key = resolve(searchDir);
  const current = getConfig(searchDir);
  configCache.set(key, deepMerge(current, options));
  log.debug('Config updated', { options, searchDir: key });
}

export function resetConfig(searchDir?: string): void {
  if (searchDir) {
    configCache.delete(resolve(searchDir));
  } else {
    configCache.clear();
  }
}

export function getModelForTier(tier: ModelTier, provider?: string): string {
  const config = getConfig();
  const effectiveProvider = provider ?? config.models?.defaultProvider ?? DEFAULT_PROVIDER;

  if (config.models?.tiers?.[tier]) {
    return config.models.tiers[tier];
  }

  if (config.models?.providers?.[effectiveProvider]?.[tier]) {
    return config.models.providers[effectiveProvider][tier];
  }

  return (
    DEFAULT_MODELS[effectiveProvider as Provider]?.[tier] ?? DEFAULT_MODELS[DEFAULT_PROVIDER][tier]
  );
}

export function defineConfig(config: PartialAgentConfig): PartialAgentConfig {
  return config;
}

export function getToolConfig<T extends Record<string, unknown>>(
  toolName: 'shell' | 'glob' | 'grep' | 'plan',
): T {
  const config = getConfig();
  const toolsConfig = (config as Record<string, unknown>).tools as
    | Record<string, unknown>
    | undefined;
  return (toolsConfig?.[toolName] ?? {}) as T;
}

export function getServerConfig(): { port?: number; host?: string } {
  const config = getConfig();
  return ((config as Record<string, unknown>).server as { port?: number; host?: string }) ?? {};
}

export function getClientConfig(): {
  timeout?: number;
  retries?: number;
  websocket?: { reconnectDelay?: number; maxReconnects?: number };
} {
  const config = getConfig();
  return ((config as Record<string, unknown>).client as { timeout?: number }) ?? {};
}
