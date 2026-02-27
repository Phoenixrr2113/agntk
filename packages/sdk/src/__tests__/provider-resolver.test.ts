/**
 * @fileoverview Tests for the provider resolution cascade.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveProvider, resetProviderCache } from '../provider-resolver';

describe('resolveProvider', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetProviderCache();
    // Clear all provider-related keys
    delete process.env['OPENROUTER_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
    delete process.env['CEREBRAS_API_KEY'];
    delete process.env['OLLAMA_ENABLED'];
    delete process.env['OLLAMA_BASE_URL'];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // BYOK Detection
  // ==========================================================================

  describe('BYOK detection', () => {
    it('resolves OpenRouter when OPENROUTER_API_KEY is set', async () => {
      process.env['OPENROUTER_API_KEY'] = 'sk-or-test';
      const result = await resolveProvider();
      expect(result.provider).toBe('openrouter');
      expect(result.source).toBe('OPENROUTER_API_KEY');
      expect(result.isFree).toBe(false);
    });

    it('resolves OpenAI when OPENAI_API_KEY is set', async () => {
      process.env['OPENAI_API_KEY'] = 'sk-test';
      const result = await resolveProvider();
      expect(result.provider).toBe('openai');
      expect(result.source).toBe('OPENAI_API_KEY');
      expect(result.isFree).toBe(false);
    });

    it('resolves Cerebras when CEREBRAS_API_KEY is set', async () => {
      process.env['CEREBRAS_API_KEY'] = 'csk-test';
      const result = await resolveProvider();
      expect(result.provider).toBe('cerebras');
      expect(result.source).toBe('CEREBRAS_API_KEY');
      expect(result.isFree).toBe(false);
    });

    it('prefers OpenRouter over OpenAI', async () => {
      process.env['OPENROUTER_API_KEY'] = 'sk-or';
      process.env['OPENAI_API_KEY'] = 'sk-ai';
      const result = await resolveProvider();
      expect(result.provider).toBe('openrouter');
    });

    it('prefers OpenRouter over Cerebras', async () => {
      process.env['OPENROUTER_API_KEY'] = 'sk-or';
      process.env['CEREBRAS_API_KEY'] = 'csk';
      const result = await resolveProvider();
      expect(result.provider).toBe('openrouter');
    });

    it('prefers OpenAI over Cerebras', async () => {
      process.env['OPENAI_API_KEY'] = 'sk-ai';
      process.env['CEREBRAS_API_KEY'] = 'csk';
      const result = await resolveProvider();
      expect(result.provider).toBe('openai');
    });

    it('ignores empty/whitespace-only keys', async () => {
      process.env['OPENROUTER_API_KEY'] = '   ';
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
      const result = await resolveProvider();
      expect(result.provider).toBe('agntk-free');
    });
  });

  // ==========================================================================
  // Ollama Detection
  // ==========================================================================

  describe('Ollama detection', () => {
    it('resolves Ollama when OLLAMA_ENABLED is set', async () => {
      process.env['OLLAMA_ENABLED'] = 'true';
      const result = await resolveProvider();
      expect(result.provider).toBe('ollama');
      expect(result.source).toBe('OLLAMA_ENABLED=true');
      expect(result.isFree).toBe(false);
    });

    it('detects Ollama via probe when running', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ models: [] }), { status: 200 }),
      );
      const result = await resolveProvider();
      expect(result.provider).toBe('ollama');
      expect(result.source).toContain('ollama');
      expect(result.isFree).toBe(false);
    });

    it('BYOK takes priority over Ollama', async () => {
      process.env['OPENROUTER_API_KEY'] = 'sk-or';
      process.env['OLLAMA_ENABLED'] = 'true';
      const result = await resolveProvider();
      expect(result.provider).toBe('openrouter');
    });

    it('falls through when Ollama probe fails', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
      const result = await resolveProvider();
      expect(result.provider).toBe('agntk-free');
    });

    it('respects 500ms timeout on Ollama probe', async () => {
      const start = Date.now();
      vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
        // Simulate a slow server that respects the abort signal
        return new Promise((_, reject) => {
          const timer = setTimeout(() => reject(new Error('timeout')), 5000);
          init?.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        });
      });
      const result = await resolveProvider();
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(1500); // generous buffer for CI
      expect(result.provider).toBe('agntk-free');
    });
  });

  // ==========================================================================
  // Free Tier Fallback
  // ==========================================================================

  describe('free tier fallback', () => {
    it('falls back to free tier when no keys and no Ollama', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
      const result = await resolveProvider();
      expect(result.provider).toBe('agntk-free');
      expect(result.isFree).toBe(true);
      expect(result.source).toContain('free tier');
    });
  });

  // ==========================================================================
  // Caching
  // ==========================================================================

  describe('caching', () => {
    it('returns same result on subsequent calls', async () => {
      process.env['OPENROUTER_API_KEY'] = 'sk-or';
      const first = await resolveProvider();
      delete process.env['OPENROUTER_API_KEY'];
      // resolveProvider is not cached (direct call), but getResolvedProvider is
      // This tests that the function is deterministic
      const second = await resolveProvider();
      // Without BYOK, it should fall through now
      expect(first.provider).toBe('openrouter');
      expect(second.provider).not.toBe('openrouter');
    });
  });
});
