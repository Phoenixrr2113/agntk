/**
 * @fileoverview Provider auto-resolution cascade for the SDK.
 *
 * Determines which LLM provider to use based on a priority cascade:
 * 1. BYOK: User has OPENROUTER_API_KEY, OPENAI_API_KEY, or CEREBRAS_API_KEY.
 * 2. Ollama: Running locally at localhost:11434 (with system-aware model selection).
 * 3. Free tier: agntk proxy at api.agntk.dev backed by Cerebras.
 */
import { createLogger } from '@agntk/logger';
import {
  detectSystem,
  recommendOllamaModels,
  type OllamaModelRecommendation,
} from './system-detect';

const log = createLogger('@agntk/core:provider-resolver');

export interface ResolvedProvider {
  provider: string;

  source: string;

  isFree: boolean;

  ollamaModels?: OllamaModelRecommendation;

  ollamaInstalledModels?: string[];

  ollamaSkipReason?: string;
}

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

let _ollamaSkipReason: string | null = null;

function checkOllamaExplicit(): ResolvedProvider | null {
  if (process.env['OLLAMA_ENABLED'] === 'true') {
    const sysProfile = detectSystem();
    const models = recommendOllamaModels(sysProfile);
    log.info('Ollama explicitly enabled via OLLAMA_ENABLED', { tier: models.tier });
    return {
      provider: 'ollama',
      source: 'OLLAMA_ENABLED=true',
      isFree: false,
      ollamaModels: models,
    };
  }
  return null;
}

async function probeOllama(): Promise<ResolvedProvider | null> {
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

    const data = (await response.json()) as { models?: Array<{ name: string }> };
    const installedModels = (data.models || []).map((m) => m.name.toLowerCase());

    if (installedModels.length === 0) {
      log.info('Ollama running but no models installed', { baseUrl });
      return null;
    }

    const sysProfile = detectSystem();
    const recommendation = recommendOllamaModels(sysProfile, installedModels);

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

function getFreeTier(): ResolvedProvider {
  log.info('Using agntk free tier');
  const result: ResolvedProvider = {
    provider: 'agntk-free',
    source: 'free tier (Cerebras)',
    isFree: true,
  };
  if (_ollamaSkipReason) {
    result.ollamaSkipReason = _ollamaSkipReason;
  }
  return result;
}

export async function resolveProvider(): Promise<ResolvedProvider> {
  _ollamaSkipReason = null;

  const byok = checkBYOK();
  if (byok) return byok;

  const ollamaExplicit = checkOllamaExplicit();
  if (ollamaExplicit) return ollamaExplicit;

  const ollamaProbe = await probeOllama();
  if (ollamaProbe) return ollamaProbe;

  return getFreeTier();
}

let cachedProvider: ResolvedProvider | null = null;
let resolvePromise: Promise<ResolvedProvider> | null = null;

export async function getResolvedProvider(): Promise<ResolvedProvider> {
  if (cachedProvider) return cachedProvider;
  if (resolvePromise) return resolvePromise;

  resolvePromise = resolveProvider().then((p) => {
    cachedProvider = p;
    return p;
  });

  return resolvePromise;
}

export function resetProviderCache(): void {
  cachedProvider = null;
  resolvePromise = null;
}
