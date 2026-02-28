/**
 * @fileoverview Tests for system detection and Ollama model recommendation.
 */

import { describe, it, expect } from 'vitest';
import {
  isCloudModel,
  isUsableSize,
  recommendOllamaModels,
  type SystemProfile,
} from '../system-detect';

// ============================================================================
// isCloudModel
// ============================================================================

describe('isCloudModel', () => {
  it('detects -cloud suffix', () => {
    expect(isCloudModel('qwen3-coder:480b-cloud')).toBe(true);
    expect(isCloudModel('gpt-oss:120b-cloud')).toBe(true);
  });

  it('detects :cloud tag', () => {
    expect(isCloudModel('qwen3.5:cloud')).toBe(true);
  });

  it('rejects local models', () => {
    expect(isCloudModel('qwen3:8b')).toBe(false);
    expect(isCloudModel('qwen3-coder:30b')).toBe(false);
    expect(isCloudModel('llama3.1:70b')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isCloudModel('QWEN3-CODER:480B-CLOUD')).toBe(true);
    expect(isCloudModel('Qwen3.5:Cloud')).toBe(true);
  });
});

// ============================================================================
// isUsableSize
// ============================================================================

describe('isUsableSize', () => {
  it('accepts cloud models regardless of size label', () => {
    expect(isUsableSize('qwen3-coder:480b-cloud')).toBe(true);
    expect(isUsableSize('qwen3.5:cloud')).toBe(true);
  });

  it('accepts models >= 8b', () => {
    expect(isUsableSize('qwen3:8b')).toBe(true);
    expect(isUsableSize('qwen3:14b')).toBe(true);
    expect(isUsableSize('qwen3:32b')).toBe(true);
    expect(isUsableSize('llama3.1:70b')).toBe(true);
    expect(isUsableSize('qwen3-coder:30b')).toBe(true);
  });

  it('rejects models < 8b', () => {
    expect(isUsableSize('qwen3:0.6b')).toBe(false);
    expect(isUsableSize('qwen3:1.7b')).toBe(false);
    expect(isUsableSize('phi3:3.8b')).toBe(false);
  });

  it('assumes unknown sizes are usable', () => {
    expect(isUsableSize('deepseek-coder:latest')).toBe(true);
    expect(isUsableSize('mistral:latest')).toBe(true);
  });
});

// ============================================================================
// recommendOllamaModels
// ============================================================================

/** Helper to create a fake system profile */
function fakeProfile(totalRAMGb: number, usableForModelsGb: number): SystemProfile {
  return {
    totalRAMGb,
    usableForModelsGb,
    platform: 'darwin',
    isAppleSilicon: true,
    nvidiaVRAMGb: null,
  };
}

describe('recommendOllamaModels', () => {
  describe('without installed models (hardware-ideal)', () => {
    it('returns small tier for limited memory', () => {
      const rec = recommendOllamaModels(fakeProfile(8, 5));
      expect(rec.tier).toBe('small');
      expect(rec.standard).toBe('qwen3:8b');
    });

    it('returns medium tier for moderate memory', () => {
      const rec = recommendOllamaModels(fakeProfile(24, 15));
      expect(rec.tier).toBe('medium');
      expect(rec.standard).toBe('qwen3-coder:30b');
      expect(rec.fast).toBe('qwen3:8b');
    });

    it('returns large tier for high memory', () => {
      const rec = recommendOllamaModels(fakeProfile(64, 40));
      expect(rec.tier).toBe('large');
      expect(rec.powerful).toBe('qwen3.5:35b');
      expect(rec.standard).toBe('qwen3-coder:30b');
    });

    it('warns for very limited memory', () => {
      const rec = recommendOllamaModels(fakeProfile(4, 2));
      expect(rec.tier).toBe('small');
      expect(rec.reason).toContain('slow');
    });
  });

  describe('with installed models', () => {
    it('sets noUsableModels when only sub-8b installed', () => {
      const rec = recommendOllamaModels(fakeProfile(16, 10), ['qwen3:0.6b', 'qwen3:1.7b']);
      expect(rec.noUsableModels).toBe(true);
    });

    it('does not set noUsableModels when usable model exists', () => {
      const rec = recommendOllamaModels(fakeProfile(16, 10), ['qwen3:8b']);
      expect(rec.noUsableModels).toBeUndefined();
    });

    it('picks cloud model as best available', () => {
      const rec = recommendOllamaModels(fakeProfile(8, 5), ['qwen3:0.6b', 'qwen3-coder:480b-cloud']);
      expect(rec.noUsableModels).toBeUndefined();
      expect(rec.standard).toBe('qwen3-coder:480b-cloud');
    });

    it('clamps ideal to installed models', () => {
      // Large tier ideals are qwen3-coder:30b and qwen3.5:35b,
      // but only qwen3:14b is installed
      const rec = recommendOllamaModels(fakeProfile(64, 40), ['qwen3:14b']);
      expect(rec.tier).toBe('large');
      // Since ideal models aren't installed, falls back to best available
      expect(rec.standard).toBe('qwen3:14b');
      expect(rec.powerful).toBe('qwen3:14b');
    });

    it('uses ideal model when it is installed', () => {
      const rec = recommendOllamaModels(fakeProfile(16, 10), ['qwen3:8b', 'qwen3-coder:30b']);
      expect(rec.tier).toBe('medium');
      expect(rec.fast).toBe('qwen3:8b');
      expect(rec.standard).toBe('qwen3-coder:30b');
    });

    it('prefers cloud over local for all tiers', () => {
      const rec = recommendOllamaModels(fakeProfile(24, 15), ['qwen3:8b', 'gpt-oss:120b-cloud']);
      // Cloud model wins for every tier — runs on remote infra, always better
      expect(rec.fast).toBe('gpt-oss:120b-cloud');
      expect(rec.standard).toBe('gpt-oss:120b-cloud');
      expect(rec.reasoning).toBe('gpt-oss:120b-cloud');
      expect(rec.powerful).toBe('gpt-oss:120b-cloud');
    });

    it('accepts non-qwen models that are usable size', () => {
      const rec = recommendOllamaModels(fakeProfile(64, 40), ['llama3.1:70b']);
      expect(rec.noUsableModels).toBeUndefined();
      expect(rec.standard).toBe('llama3.1:70b');
    });

    it('accepts models with unknown size', () => {
      const rec = recommendOllamaModels(fakeProfile(16, 10), ['deepseek-coder:latest']);
      expect(rec.noUsableModels).toBeUndefined();
    });
  });
});
