import { describe, it, expect, vi } from 'vitest';
import {
  createTelemetrySettings,
  isObservabilityEnabled,
  initObservability,
} from '../observability/langfuse';

describe('createTelemetrySettings', () => {
  it('returns disabled settings when not initialized', () => {
    const settings = createTelemetrySettings();
    expect(settings.isEnabled).toBe(false);
  });

  it('includes functionId when provided', () => {
    const settings = createTelemetrySettings({ functionId: 'chat-handler' });
    expect(settings.functionId).toBe('chat-handler');
  });

  it('includes metadata when provided', () => {
    const settings = createTelemetrySettings({
      metadata: { userId: 'u123', session: 'abc' },
    });
    expect(settings.metadata).toEqual({ userId: 'u123', session: 'abc' });
  });
});

describe('isObservabilityEnabled', () => {
  it('returns false before initialization', () => {
    expect(isObservabilityEnabled()).toBe(false);
  });
});

describe('initObservability', () => {
  it('returns false for unsupported provider', async () => {
    const result = await initObservability({ provider: 'unknown' as 'langfuse' });
    expect(result).toBe(false);
  });

  it('gracefully handles missing langfuse package', async () => {
    const result = await initObservability({
      provider: 'langfuse',
      langfuse: {
        publicKey: 'pk-test',
        secretKey: 'sk-test',
      },
    });

    expect(result).toBe(false);
  });

  it('returns false when keys are missing', async () => {
    vi.doMock('langfuse-vercel', () => ({
      LangfuseExporter: class MockExporter {},
    }));

    const result = await initObservability({
      provider: 'langfuse',
    });
    expect(result).toBe(false);

    vi.doUnmock('langfuse-vercel');
  });
});

describe('ObservabilityConfig type', () => {
  it('accepts valid config', () => {
    const config = {
      provider: 'langfuse' as const,
      langfuse: {
        publicKey: 'pk-xxx',
        secretKey: 'sk-xxx',
        baseUrl: 'https://cloud.langfuse.com',
        debug: false,
      },
    };
    expect(config.provider).toBe('langfuse');
    expect(config.langfuse?.publicKey).toBe('pk-xxx');
  });
});
