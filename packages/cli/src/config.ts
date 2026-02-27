/**
 * @fileoverview Config utilities for agntk CLI.
 * API key detection and config file loading.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ============================================================================
// API Key Detection
// ============================================================================

interface ApiKeyResult {
  provider: string;
  apiKey: string;
}

const API_KEY_ENV_VARS: Array<{ env: string; provider: string }> = [
  { env: 'OPENROUTER_API_KEY', provider: 'openrouter' },
  { env: 'OPENAI_API_KEY', provider: 'openai' },
  { env: 'CEREBRAS_API_KEY', provider: 'cerebras' },
];

let dotenvFallbackLoaded = false;

/**
 * Load ~/.agntk/.env as a fallback for API key persistence.
 * Uses override: false so explicit env vars (from `export`) always win.
 */
export function loadDotenvFallback(): void {
  if (dotenvFallbackLoaded) return;
  dotenvFallbackLoaded = true;

  const globalEnvPath = join(homedir(), '.agntk', '.env');
  if (!existsSync(globalEnvPath)) return;

  try {
    // Parse the .env file manually to avoid requiring dotenv at this level.
    // dotenv/config already ran for cwd — this covers ~/.agntk/.env.
    const content = readFileSync(globalEnvPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      // Don't override existing env vars
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // Silently ignore read errors
  }
}

/**
 * Detect API key from environment variables.
 * Loads ~/.agntk/.env as fallback before checking.
 * Returns the first found key with its provider.
 */
export function detectApiKey(): ApiKeyResult | null {
  loadDotenvFallback();

  for (const { env, provider } of API_KEY_ENV_VARS) {
    const key = process.env[env];
    if (key && key.trim().length > 0) {
      return { provider, apiKey: key };
    }
  }
  return null;
}

// ============================================================================
// Config File Loading
// ============================================================================

interface ConfigFileData {
  name?: string;
  instructions?: string;
  model?: string;
  maxSteps?: number;
  workspace?: string;
}

const CONFIG_FILENAMES = [
  'agntk.config.json',
  '.agntkrc.json',
];

/**
 * Load config file from the workspace directory.
 * Tries multiple filenames, returns first found.
 */
export function loadConfigFile(workspace: string, explicitPath?: string | null): ConfigFileData {
  if (explicitPath) {
    if (!existsSync(explicitPath)) {
      return {};
    }
    try {
      const content = readFileSync(explicitPath, 'utf-8');
      return JSON.parse(content) as ConfigFileData;
    } catch {
      return {};
    }
  }

  for (const filename of CONFIG_FILENAMES) {
    const filePath = join(workspace, filename);
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        return JSON.parse(content) as ConfigFileData;
      } catch {
        // Silently skip unparseable files
      }
    }
  }

  return {};
}
