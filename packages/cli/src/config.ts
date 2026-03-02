/**
 * @fileoverview Config utilities for agntk CLI.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

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
