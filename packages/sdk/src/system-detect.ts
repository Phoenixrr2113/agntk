import { createLogger } from '@agntk/logger';
import os from 'node:os';
import { execSync } from 'node:child_process';

const log = createLogger('@agntk/core:system-detect');

export interface SystemProfile {
  totalRAMGb: number;

  usableForModelsGb: number;

  platform: string;

  isAppleSilicon: boolean;

  nvidiaVRAMGb: number | null;
}

export type OllamaModelTier = 'small' | 'medium' | 'large';

export interface OllamaModelRecommendation {
  tier: OllamaModelTier;

  fast: string;
  standard: string;
  reasoning: string;
  powerful: string;

  reason: string;

  noUsableModels?: boolean;
}

export function isCloudModel(tag: string): boolean {
  const lower = tag.toLowerCase();
  return lower.includes('-cloud') || lower.endsWith(':cloud');
}

export function isUsableSize(tag: string): boolean {
  if (isCloudModel(tag)) return true;

  const match = tag.match(/(\d+(?:\.\d+)?)b/i);
  if (!match) return true;
  return parseFloat(match[1]) >= 8;
}

const MODEL_TIERS: Record<OllamaModelTier, Omit<OllamaModelRecommendation, 'reason'>> = {
  small: {
    tier: 'small',
    fast: 'qwen3:8b',
    standard: 'qwen3:8b',
    reasoning: 'qwen3:8b',
    powerful: 'qwen3:8b',
  },
  medium: {
    tier: 'medium',
    fast: 'qwen3:8b',
    standard: 'qwen3-coder:30b',
    reasoning: 'qwen3-coder:30b',
    powerful: 'qwen3-coder:30b',
  },
  large: {
    tier: 'large',
    fast: 'qwen3:8b',
    standard: 'qwen3-coder:30b',
    reasoning: 'qwen3.5:35b',
    powerful: 'qwen3.5:35b',
  },
};

const MODEL_PREFERENCE = [
  'qwen3-coder:480b-cloud',
  'qwen3.5:cloud',
  'qwen3.5:397b-cloud',
  'gpt-oss:120b-cloud',

  'qwen3-coder:30b',
  'qwen3.5:35b',
  'qwen3.5:27b',
  'qwen3:32b',
  'qwen3:14b',
  'qwen3:8b',
];

function detectAppleSilicon(): boolean {
  if (os.platform() !== 'darwin') return false;
  try {
    const brand = execSync('sysctl -n machdep.cpu.brand_string', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return brand.includes('Apple');
  } catch {
    return os.arch() === 'arm64';
  }
}

function detectNvidiaVRAM(): number | null {
  try {
    const output = execSync('nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits', {
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    const mb = parseInt(output.split('\n')[0] ?? '0', 10);
    if (!isNaN(mb) && mb > 0) {
      return Math.round((mb / 1024) * 10) / 10;
    }
    return null;
  } catch {
    return null;
  }
}

export function detectSystem(): SystemProfile {
  const totalBytes = os.totalmem();
  const totalRAMGb = Math.round((totalBytes / 1024 ** 3) * 10) / 10;
  const platform = os.platform();
  const isAppleSilicon = detectAppleSilicon();
  const nvidiaVRAMGb = detectNvidiaVRAM();

  let usableForModelsGb: number;

  if (nvidiaVRAMGb !== null) {
    usableForModelsGb = nvidiaVRAMGb - 1;
  } else if (isAppleSilicon) {
    usableForModelsGb = totalRAMGb * 0.65;
  } else {
    usableForModelsGb = totalRAMGb - 3;
  }

  usableForModelsGb = Math.max(0, usableForModelsGb);

  const profile: SystemProfile = {
    totalRAMGb,
    usableForModelsGb,
    platform,
    isAppleSilicon,
    nvidiaVRAMGb,
  };

  log.debug('System profile', { ...profile });
  return profile;
}

export function recommendOllamaModels(
  profile?: SystemProfile,
  installedModels?: string[],
): OllamaModelRecommendation {
  const sys = profile || detectSystem();
  const mem = sys.usableForModelsGb;

  let ideal: OllamaModelRecommendation;

  if (mem < 4) {
    log.warn('Very limited memory for local models', { usableGb: mem });
    ideal = {
      ...MODEL_TIERS.small,
      reason: `Only ${sys.totalRAMGb} GB RAM detected — qwen3:8b may be slow. Consider using the free tier instead.`,
    };
  } else if (mem < 10) {
    ideal = {
      ...MODEL_TIERS.small,
      reason: `${sys.totalRAMGb} GB RAM → qwen3:8b (best fit for your hardware)`,
    };
  } else if (mem < 20) {
    ideal = {
      ...MODEL_TIERS.medium,
      reason: `${sys.totalRAMGb} GB RAM → qwen3-coder:30b for standard tasks, qwen3:8b for fast tasks`,
    };
  } else {
    ideal = {
      ...MODEL_TIERS.large,
      reason: `${sys.totalRAMGb} GB RAM → qwen3.5:35b for reasoning/powerful, qwen3-coder:30b for standard`,
    };
  }

  if (!installedModels || installedModels.length === 0) {
    return ideal;
  }

  const installed = new Set(installedModels.map((m) => m.toLowerCase()));
  const bestAvailable = pickBestAvailable(installed);

  if (!bestAvailable) {
    log.info('No usable models installed', { installed: [...installed] });
    return {
      ...ideal,
      noUsableModels: true,
      reason: 'No usable models found (need 8b+ local or cloud model)',
    };
  }

  const bestIsCloud = isCloudModel(bestAvailable);
  const clamp = (model: string) => {
    if (bestIsCloud) return bestAvailable;
    const norm = model.toLowerCase();
    if (installed.has(norm) || [...installed].some((m) => m.startsWith(norm))) {
      return model;
    }
    return bestAvailable;
  };

  const result = {
    tier: ideal.tier,
    fast: clamp(ideal.fast),
    standard: clamp(ideal.standard),
    reasoning: clamp(ideal.reasoning),
    powerful: clamp(ideal.powerful),
    reason: '',
  };

  const unique = [...new Set([result.fast, result.standard, result.reasoning, result.powerful])];
  result.reason = `${sys.totalRAMGb} GB RAM → ${unique.join(', ')}`;

  return result;
}

function pickBestAvailable(installed: Set<string>): string | null {
  for (const model of MODEL_PREFERENCE) {
    if (installed.has(model) || [...installed].some((m) => m.startsWith(model))) {
      return model;
    }
  }

  for (const model of installed) {
    if (isUsableSize(model)) {
      return model;
    }
  }

  return null;
}

export async function getOllamaModels(baseUrl?: string): Promise<string[]> {
  const rawUrl = baseUrl || process.env['OLLAMA_BASE_URL'] || 'http://localhost:11434';
  const url = rawUrl.replace(/\/(api|v1)\/?$/, '');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);

  try {
    const res = await fetch(`${url}/api/tags`, {
      signal: controller.signal,
      method: 'GET',
    });
    clearTimeout(timeout);

    if (!res.ok) return [];

    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return (data.models || []).map((m) => m.name);
  } catch {
    clearTimeout(timeout);
    return [];
  }
}

export async function hasOllamaModel(model: string, baseUrl?: string): Promise<boolean> {
  const models = await getOllamaModels(baseUrl);

  const normalized = model.toLowerCase();
  return models.some((m) => m.toLowerCase().startsWith(normalized));
}
