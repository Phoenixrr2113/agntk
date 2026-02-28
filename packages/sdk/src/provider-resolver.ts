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
  /** When provider is 'ollama', the list of models actually installed */
  ollamaInstalledModels?: string[];
  /** When Ollama was skipped despite running, explains why (for CLI display) */
  ollamaSkipReason?: string;
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
// Ollama Skip Reason (set by probeOllama, read by getFreeTier)
// ============================================================================

let _ollamaSkipReason: string | null = null;

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
 * If Ollama is running AND has at least one model pulled, detect system
 * hardware and recommend the best available models.
 * Returns within 500ms regardless of whether Ollama is running.
 */
async function probeOllama(): Promise<ResolvedProvider | null> {
  // Strip trailing path segments (/api, /v1, etc.) — the probe needs the raw Ollama host.
  // Users may set OLLAMA_BASE_URL to "http://localhost:11434/api" or "/v1" for the AI SDK,
  // but the native Ollama API lives at the root (e.g. /api/tags, not /api/api/tags).
  const rawUrl = process.env['OLLAMA_BASE_URL'] || 'http://localhost:11434';
  const baseUrl = rawUrl.replace(/\/(api|v1)\/?$/, '');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 500);

  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      signal: controller.signal,
      method: 'GET',
    });
    clearTimeout(timeout);

    if (!response.ok) return null;

    // Parse which models are actually installed
    const data = (await response.json()) as { models?: Array<{ name: string }> };
    const installedModels = (data.models || []).map((m) => m.name.toLowerCase());

    if (installedModels.length === 0) {
      log.info('Ollama running but no models installed', { baseUrl });
      return null;
    }

    // Detect hardware and recommend the best model from what's actually installed
    const sysProfile = detectSystem();
    const recommendation = recommendOllamaModels(sysProfile, installedModels);

    // If no usable models found (all sub-8b, no cloud), skip Ollama
    if (recommendation.noUsableModels) {
      _ollamaSkipReason =
        'Ollama running but no 8b+ model found.\n' +
        '        Run `ollama pull qwen3-coder:30b` for local, or `ollama pull qwen3-coder:480b-cloud` for cloud.\n' +
        '        Using free tier for now.';
      log.info('Ollama skipped — no usable models', { baseUrl, installed: installedModels });
      return null;
    }

    log.info('Ollama detected', {
      baseUrl,
      tier: recommendation.tier,
      standard: recommendation.standard,
      installed: installedModels,
      reason: recommendation.reason,
    });
    return {
      provider: 'ollama',
      source: `ollama (${baseUrl})`,
      isFree: false,
      ollamaModels: recommendation,
      ollamaInstalledModels: installedModels,
    };
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
  const result: ResolvedProvider = { provider: 'agntk-free', source: 'free tier (Cerebras)', isFree: true };
  if (_ollamaSkipReason) {
    result.ollamaSkipReason = _ollamaSkipReason;
  }
  return result;
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
  _ollamaSkipReason = null;

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
