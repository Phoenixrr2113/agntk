/**
 * @fileoverview System hardware detection for automatic Ollama model selection.
 *
 * Detects available RAM/VRAM and selects the largest Qwen3 model the system
 * can comfortably run. Falls back conservatively — better to run a smaller
 * model fast than a larger model that swaps to disk.
 *
 * Memory thresholds (Q4_K_M quantization):
 *   qwen3:8b   ~5-6 GB  → needs ≥8 GB total RAM
 *   qwen3:14b  ~8-10 GB → needs ≥16 GB total RAM
 *   qwen3:32b  ~18-22 GB → needs ≥32 GB total RAM
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
  /** Model tag to pull/use (e.g. "qwen3:8b") */
  fast: string;
  standard: string;
  reasoning: string;
  powerful: string;
  /** Human-readable reason */
  reason: string;
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
    standard: 'qwen3:14b',
    reasoning: 'qwen3:14b',
    powerful: 'qwen3:14b',
  },
  large: {
    tier: 'large',
    fast: 'qwen3:8b',
    standard: 'qwen3:14b',
    reasoning: 'qwen3:32b',
    powerful: 'qwen3:32b',
  },
};

// ============================================================================
// System Detection
// ============================================================================

/**
 * Detect whether this is an Apple Silicon Mac.
 */
function detectAppleSilicon(): boolean {
  if (os.platform() !== 'darwin') return false;
  try {
    const brand = execSync('sysctl -n machdep.cpu.brand_string', { encoding: 'utf-8' }).trim();
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
      { encoding: 'utf-8', timeout: 3000 },
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
 * Select the best Ollama model tier based on system capabilities.
 *
 * Thresholds (usable memory for the model weights):
 *   < 6 GB  → too small, warn user
 *   6-10 GB → small (qwen3:8b everywhere)
 *   10-18 GB → medium (qwen3:14b for standard+)
 *   18+ GB  → large (qwen3:32b for reasoning/powerful)
 */
export function recommendOllamaModels(profile?: SystemProfile): OllamaModelRecommendation {
  const sys = profile || detectSystem();
  const mem = sys.usableForModelsGb;

  if (mem < 4) {
    log.warn('Very limited memory for local models', { usableGb: mem });
    return {
      ...MODEL_TIERS.small,
      reason: `Only ${sys.totalRAMGb} GB RAM detected — qwen3:8b may be slow. Consider using the free tier instead.`,
    };
  }

  if (mem < 10) {
    return {
      ...MODEL_TIERS.small,
      reason: `${sys.totalRAMGb} GB RAM → qwen3:8b (best fit for your hardware)`,
    };
  }

  if (mem < 18) {
    return {
      ...MODEL_TIERS.medium,
      reason: `${sys.totalRAMGb} GB RAM → qwen3:14b for standard tasks, qwen3:8b for fast tasks`,
    };
  }

  return {
    ...MODEL_TIERS.large,
    reason: `${sys.totalRAMGb} GB RAM → qwen3:32b for reasoning/powerful, qwen3:14b for standard`,
  };
}

// ============================================================================
// Ollama Model Availability
// ============================================================================

/**
 * Check which models Ollama already has pulled.
 */
export async function getOllamaModels(baseUrl?: string): Promise<string[]> {
  const url = baseUrl || process.env['OLLAMA_BASE_URL'] || 'http://localhost:11434';
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
