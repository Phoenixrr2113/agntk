/**
 * @fileoverview Provider auto-resolution cascade.
 *
 * Priority:
 * 1. BYOK: User has OPENROUTER_API_KEY, OPENAI_API_KEY, or CEREBRAS_API_KEY
 * 2. Ollama: Running locally at localhost:11434 (with system-aware model selection)
 * 3. Free tier: agntk proxy at api.agntk.dev backed by Cerebras
 */

import { createLogger } from '@agntk/logger';
import { detectSystem, recommendOllamaModels, type OllamaModelRecommendation } from './system-detect';

const log = createLogger('@agntk/core:provider-resolver');

// ============================================================================
// Types
// ============================================================================

export interface ResolvedProvider {
  /** Provider name matching PROVIDER_CONFIGS key */
  provider: string;
  /** Human-readable explanation of how this was resolved */
  source: string;
  /** Whether this is the free tier (for display/rate-limit messaging) */
  isFree: boolean;
  /** When provider is 'ollama', hardware-aware model recommendations */
  ollamaModels?: OllamaModelRecommendation;
}

// ============================================================================
// BYOK Detection (sync, instant)
// ============================================================================

const BYOK_KEYS = [
  { env: 'OPENROUTER_API_KEY', provider: 'openrouter' },
  { env: 'OPENAI_API_KEY', provider: 'openai' },
  { env: 'CEREBRAS_API_KEY', provider: 'cerebras' },
] as const;

function checkBYOK(): ResolvedProvider | null {
  for (const { env, provider } of BYOK_KEYS) {
    const key = process.env[env];
    if (key && key.trim().length > 0) {
      log.info('BYOK key detected', { provider, env });
      return { provider, source: env, isFree: false };
    }
  }
  return null;
}

// ============================================================================
// Ollama Detection
// ============================================================================

/**
 * Check if OLLAMA_ENABLED is explicitly set (legacy support).
 * Also detects hardware for model recommendation.
 */
function checkOllamaExplicit(): ResolvedProvider | null {
  if (process.env['OLLAMA_ENABLED'] === 'true') {
    const sysProfile = detectSystem();
    const models = recommendOllamaModels(sysProfile);
    log.info('Ollama explicitly enabled via OLLAMA_ENABLED', { tier: models.tier });
    return { provider: 'ollama', source: 'OLLAMA_ENABLED=true', isFree: false, ollamaModels: models };
  }
  return null;
}

/**
 * Probe Ollama at localhost:11434 with a fast health check.
 * If Ollama is running, detect system hardware and recommend models.
 * Returns within 500ms regardless of whether Ollama is running.
 */
async function probeOllama(): Promise<ResolvedProvider | null> {
  const baseUrl = process.env['OLLAMA_BASE_URL'] || 'http://localhost:11434';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 500);

  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      signal: controller.signal,
      method: 'GET',
    });
    clearTimeout(timeout);

    if (response.ok) {
      // Ollama is running — detect hardware and pick best model tier
      const sysProfile = detectSystem();
      const models = recommendOllamaModels(sysProfile);
      log.info('Ollama detected', { baseUrl, tier: models.tier, reason: models.reason });
      return {
        provider: 'ollama',
        source: `ollama (${baseUrl})`,
        isFree: false,
        ollamaModels: models,
      };
    }
    return null;
  } catch {
    clearTimeout(timeout);
    log.debug('Ollama not available', { baseUrl });
    return null;
  }
}

// ============================================================================
// Free Tier Fallback
// ============================================================================

function getFreeTier(): ResolvedProvider {
  log.info('Using agntk free tier');
  return { provider: 'agntk-free', source: 'free tier (Cerebras)', isFree: true };
}

// ============================================================================
// Main Cascade
// ============================================================================

/**
 * Resolve the best available provider.
 *
 * Cascade:
 * 1. BYOK keys (sync, instant)
 * 2. Explicit OLLAMA_ENABLED (sync, instant)
 * 3. Ollama auto-detect probe (async, <=500ms)
 * 4. Free tier fallback (sync, instant)
 */
export async function resolveProvider(): Promise<ResolvedProvider> {
  // 1. BYOK — instant
  const byok = checkBYOK();
  if (byok) return byok;

  // 2. Explicit Ollama flag — instant
  const ollamaExplicit = checkOllamaExplicit();
  if (ollamaExplicit) return ollamaExplicit;

  // 3. Ollama auto-detect — max 500ms
  const ollamaProbe = await probeOllama();
  if (ollamaProbe) return ollamaProbe;

  // 4. Free tier — always available
  return getFreeTier();
}

// ============================================================================
// Caching
// ============================================================================

let cachedProvider: ResolvedProvider | null = null;
let resolvePromise: Promise<ResolvedProvider> | null = null;

/**
 * Get the resolved provider, caching for the process lifetime.
 */
export async function getResolvedProvider(): Promise<ResolvedProvider> {
  if (cachedProvider) return cachedProvider;
  if (resolvePromise) return resolvePromise;

  resolvePromise = resolveProvider().then((p) => {
    cachedProvider = p;
    return p;
  });

  return resolvePromise;
}

/**
 * Reset the cached provider (for testing).
 */
export function resetProviderCache(): void {
  cachedProvider = null;
  resolvePromise = null;
}
