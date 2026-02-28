/**
 * @fileoverview System hardware detection for automatic Ollama model selection.
 *
 * Detects available RAM/VRAM and selects the best model the system can
 * comfortably run. Falls back conservatively — better to run a smaller
 * model fast than a larger model that swaps to disk.
 *
 * Supports both local models and Ollama cloud models (-cloud suffix).
 * Cloud models are always preferred when available since they run on
 * remote infrastructure regardless of local hardware.
 *
 * Memory thresholds (Q4_K_M quantization, local models):
 *   qwen3:8b         ~5-6 GB  → needs ≥8 GB total RAM
 *   qwen3-coder:30b  ~17 GB   → needs ≥24 GB total RAM (MoE, fast inference)
 *   qwen3.5:35b      ~20 GB   → needs ≥32 GB total RAM
 */

import { createLogger } from '@agntk/logger';
import os from 'node:os';
import { execSync } from 'node:child_process';

const log = createLogger('@agntk/core:system-detect');

// ============================================================================
// Types
// ============================================================================

export interface SystemProfile {
  /** Total system RAM in GB */
  totalRAMGb: number;
  /** Usable memory for models in GB (accounts for OS overhead + GPU sharing) */
  usableForModelsGb: number;
  /** Platform: darwin, linux, win32 */
  platform: string;
  /** Whether this is Apple Silicon (unified memory architecture) */
  isAppleSilicon: boolean;
  /** NVIDIA VRAM in GB, if detected */
  nvidiaVRAMGb: number | null;
}

export type OllamaModelTier = 'small' | 'medium' | 'large';

export interface OllamaModelRecommendation {
  /** Recommended tier */
  tier: OllamaModelTier;
  /** Model tag to pull/use for each agent tier */
  fast: string;
  standard: string;
  reasoning: string;
  powerful: string;
  /** Human-readable reason */
  reason: string;
  /** True when installed models exist but none are usable (all < 8b, no cloud) */
  noUsableModels?: boolean;
}

// ============================================================================
// Model Classification
// ============================================================================

/** Cloud models run on remote infrastructure — always usable regardless of local hardware. */
export function isCloudModel(tag: string): boolean {
  const lower = tag.toLowerCase();
  return lower.includes('-cloud') || lower.endsWith(':cloud');
}

/**
 * Check if a model is large enough for reliable agent tool-calling.
 * Models need >= 8b parameters. Cloud models are always usable.
 * Unknown sizes (e.g. "deepseek-coder:latest") are assumed usable.
 */
export function isUsableSize(tag: string): boolean {
  if (isCloudModel(tag)) return true;
  // Parse size from tags like "qwen3:14b", "llama3.1:70b", "qwen3-coder:30b"
  const match = tag.match(/(\d+(?:\.\d+)?)b/i);
  if (!match) return true; // unknown size → assume usable
  return parseFloat(match[1]) >= 8;
}

// ============================================================================
// Model Tier Definitions
// ============================================================================

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

/**
 * Preferred models ordered from best to least preferred.
 * Cloud models first (run on remote infra), then best local models.
 */
const MODEL_PREFERENCE = [
  // Cloud (always top priority)
  'qwen3-coder:480b-cloud',
  'qwen3.5:cloud',
  'qwen3.5:397b-cloud',
  'gpt-oss:120b-cloud',
  // Local (newest/best first)
  'qwen3-coder:30b',
  'qwen3.5:35b',
  'qwen3.5:27b',
  'qwen3:32b',
  'qwen3:14b',
  'qwen3:8b',
];

// ============================================================================
// System Detection
// ============================================================================

/**
 * Detect whether this is an Apple Silicon Mac.
 */
function detectAppleSilicon(): boolean {
  if (os.platform() !== 'darwin') return false;
  try {
    const brand = execSync('sysctl -n machdep.cpu.brand_string', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return brand.includes('Apple');
  } catch {
    // Fallback: check arch
    return os.arch() === 'arm64';
  }
}

/**
 * Try to detect NVIDIA GPU VRAM via nvidia-smi.
 * Returns VRAM in GB or null if no NVIDIA GPU / nvidia-smi not found.
 */
function detectNvidiaVRAM(): number | null {
  try {
    const output = execSync(
      'nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits',
      { encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
    // nvidia-smi returns MB, could have multiple GPUs — take the first
    const mb = parseInt(output.split('\n')[0], 10);
    if (!isNaN(mb) && mb > 0) {
      return Math.round(mb / 1024 * 10) / 10; // GB with 1 decimal
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Detect system hardware profile.
 */
export function detectSystem(): SystemProfile {
  const totalBytes = os.totalmem();
  const totalRAMGb = Math.round(totalBytes / (1024 ** 3) * 10) / 10;
  const platform = os.platform();
  const isAppleSilicon = detectAppleSilicon();
  const nvidiaVRAMGb = detectNvidiaVRAM();

  // Calculate usable memory for models:
  // - Reserve ~3 GB for OS + Ollama server overhead
  // - On Apple Silicon: GPU gets ~75% of unified memory, but we're more conservative
  // - On NVIDIA: model loads into VRAM, which is separate from system RAM
  let usableForModelsGb: number;

  if (nvidiaVRAMGb !== null) {
    // NVIDIA GPU: model goes into VRAM. Use that as the constraint.
    usableForModelsGb = nvidiaVRAMGb - 1; // reserve 1 GB for GPU driver/overhead
  } else if (isAppleSilicon) {
    // Apple Silicon: unified memory shared between CPU and GPU.
    // Ollama uses Metal — model sits in unified memory.
    // Reserve ~25% for OS + apps + KV cache growth.
    usableForModelsGb = totalRAMGb * 0.65;
  } else {
    // CPU-only inference: slower but uses system RAM.
    // Reserve 3 GB for OS overhead.
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

// ============================================================================
// Model Recommendation
// ============================================================================

/**
 * Select the best Ollama model tier based on system capabilities
 * and (optionally) which models are actually installed.
 *
 * When installedModels is provided, the recommendation is constrained
 * to models the user already has pulled — the best available model is
 * used for every tier rather than recommending something that would 404.
 *
 * If only sub-8b models are installed (and no cloud models), sets
 * `noUsableModels: true` so the caller can skip Ollama entirely.
 *
 * Hardware thresholds (usable memory for model weights):
 *   < 6 GB  → too small, warn user
 *   6-10 GB → small (qwen3:8b everywhere)
 *   10-20 GB → medium (qwen3-coder:30b for standard+)
 *   20+ GB  → large (qwen3.5:35b for reasoning/powerful)
 */
export function recommendOllamaModels(
  profile?: SystemProfile,
  installedModels?: string[],
): OllamaModelRecommendation {
  const sys = profile || detectSystem();
  const mem = sys.usableForModelsGb;

  // Determine the hardware-ideal tier
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

  // If we don't know what's installed, return the hardware-ideal recommendation
  if (!installedModels || installedModels.length === 0) {
    return ideal;
  }

  // Constrain to what's actually pulled — pick the best available model
  const installed = new Set(installedModels.map((m) => m.toLowerCase()));
  const bestAvailable = pickBestAvailable(installed);

  if (!bestAvailable) {
    // No usable models installed (all sub-8b, no cloud)
    log.info('No usable models installed', { installed: [...installed] });
    return {
      ...ideal,
      noUsableModels: true,
      reason: 'No usable models found (need 8b+ local or cloud model)',
    };
  }

  // Clamp each tier to what's installed.
  // Cloud models always win over local — they run on remote infrastructure
  // so they're faster and more capable regardless of local hardware.
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

  // Build reason showing what standard tier will actually use
  const unique = [...new Set([result.fast, result.standard, result.reasoning, result.powerful])];
  result.reason = `${sys.totalRAMGb} GB RAM → ${unique.join(', ')}`;

  return result;
}

/**
 * Pick the best usable model from what's installed.
 *
 * Priority:
 * 1. Preferred models in order (cloud first, then best local)
 * 2. Any other installed model that passes isUsableSize()
 * 3. null if nothing qualifies
 */
function pickBestAvailable(installed: Set<string>): string | null {
  // Check preferred models in order
  for (const model of MODEL_PREFERENCE) {
    if (installed.has(model) || [...installed].some((m) => m.startsWith(model))) {
      return model;
    }
  }

  // Check for any other usable model (non-qwen, non-preferred but >= 8b or cloud)
  for (const model of installed) {
    if (isUsableSize(model)) {
      return model;
    }
  }

  // Nothing qualifies
  return null;
}

// ============================================================================
// Ollama Model Availability
// ============================================================================

/**
 * Check which models Ollama already has pulled.
 */
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

/**
 * Check if a specific model is available in Ollama.
 */
export async function hasOllamaModel(model: string, baseUrl?: string): Promise<boolean> {
  const models = await getOllamaModels(baseUrl);
  // Normalize: "qwen3:8b" should match "qwen3:8b" and "qwen3:8b-q4_K_M"
  const normalized = model.toLowerCase();
  return models.some((m) => m.toLowerCase().startsWith(normalized));
}
