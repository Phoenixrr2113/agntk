vi.mock('@agntk/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('duck-duck-scrape', () => ({
  search: vi.fn().mockResolvedValue({ noResults: true, results: [] }),
  SafeSearchType: { STRICT: 0, MODERATE: -1, OFF: -2 },
  SearchTimeType: { DAY: 'd', WEEK: 'w', MONTH: 'm', YEAR: 'y' },
}));

import { resolveSearchProviders, getAvailableProviders, searchWithFallback } from '../resolver.js';

describe('resolveSearchProviders', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.SEARCH_PROVIDER;
    delete process.env.SEARXNG_URL;
    delete process.env.TAVILY_API_KEY;
    delete process.env.BRAVE_API_KEY;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('defaults to duckduckgo when no config', () => {
    const resolved = resolveSearchProviders();
    expect(resolved.primary.name).toBe('duckduckgo');
    expect(resolved.source).toBe('auto');
  });

  it('uses explicit provider from config', () => {
    const resolved = resolveSearchProviders({ provider: 'duckduckgo' });
    expect(resolved.primary.name).toBe('duckduckgo');
    expect(resolved.source).toBe('explicit');
  });

  it('uses SEARCH_PROVIDER env var', () => {
    process.env.SEARCH_PROVIDER = 'duckduckgo';
    const resolved = resolveSearchProviders();
    expect(resolved.primary.name).toBe('duckduckgo');
    expect(resolved.source).toBe('explicit');
  });

  it('throws for unknown explicit provider', () => {
    expect(() => resolveSearchProviders({ provider: 'nonexistent' })).toThrow(
      'Unknown search provider',
    );
  });

  it('throws for unavailable explicit provider', () => {
    delete process.env.TAVILY_API_KEY;
    expect(() => resolveSearchProviders({ provider: 'tavily' })).toThrow('not available');
  });

  it('includes searxng in fallbacks when configured', () => {
    process.env.SEARXNG_URL = 'http://localhost:8080';
    const resolved = resolveSearchProviders();
    const names = [resolved.primary.name, ...resolved.fallbacks.map((p) => p.name)];
    expect(names).toContain('searxng');
  });

  it('includes tavily in fallbacks when configured', () => {
    process.env.TAVILY_API_KEY = 'test-key';
    const resolved = resolveSearchProviders();
    const names = [resolved.primary.name, ...resolved.fallbacks.map((p) => p.name)];
    expect(names).toContain('tavily');
  });

  it('includes brave in fallbacks when configured', () => {
    process.env.BRAVE_API_KEY = 'test-brave-key';
    const resolved = resolveSearchProviders();
    const names = [resolved.primary.name, ...resolved.fallbacks.map((p) => p.name)];
    expect(names).toContain('brave');
  });

  it('uses brave as explicit provider', () => {
    process.env.BRAVE_API_KEY = 'test-brave-key';
    const resolved = resolveSearchProviders({ provider: 'brave' });
    expect(resolved.primary.name).toBe('brave');
    expect(resolved.source).toBe('explicit');
  });

  it('throws for unavailable brave without key', () => {
    delete process.env.BRAVE_API_KEY;
    expect(() => resolveSearchProviders({ provider: 'brave' })).toThrow('not available');
  });
});

describe('getAvailableProviders', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.SEARXNG_URL;
    delete process.env.TAVILY_API_KEY;
    delete process.env.BRAVE_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('always includes duckduckgo', () => {
    const providers = getAvailableProviders();
    expect(providers.some((p) => p.name === 'duckduckgo')).toBe(true);
  });

  it('includes all configured providers', () => {
    process.env.BRAVE_API_KEY = 'brave-key';
    process.env.SEARXNG_URL = 'http://localhost:8080';
    process.env.TAVILY_API_KEY = 'key';

    const providers = getAvailableProviders();
    const names = providers.map((p) => p.name);
    expect(names).toContain('duckduckgo');
    expect(names).toContain('brave');
    expect(names).toContain('searxng');
    expect(names).toContain('tavily');
  });

  it('maintains correct fallback order', () => {
    process.env.BRAVE_API_KEY = 'brave-key';
    process.env.TAVILY_API_KEY = 'tavily-key';
    process.env.SEARXNG_URL = 'http://localhost:8080';

    const providers = getAvailableProviders();
    const names = providers.map((p) => p.name);
    expect(names).toEqual(['duckduckgo', 'brave', 'tavily', 'searxng']);
  });
});

describe('searchWithFallback', () => {
  it('falls back to next provider on failure', async () => {
    const failing = {
      name: 'failing',
      requiresApiKey: false,
      isAvailable: () => true,
      search: vi.fn().mockRejectedValue(new Error('fail')),
    };

    const working = {
      name: 'working',
      requiresApiKey: false,
      isAvailable: () => true,
      search: vi.fn().mockResolvedValue({
        results: [{ title: 'ok', url: 'https://ok.com', snippet: 'ok', source: 'working' }],
        query: 'test',
        provider: 'working',
        durationMs: 100,
      }),
    };

    const response = await searchWithFallback(
      { primary: failing, fallbacks: [working], source: 'test' },
      'test',
    );

    expect(response.provider).toBe('working');
    expect(response.fallback).toBe(true);
    expect(failing.search).toHaveBeenCalled();
    expect(working.search).toHaveBeenCalled();
  });

  it('throws when all providers fail', async () => {
    const failing1 = {
      name: 'a',
      requiresApiKey: false,
      isAvailable: () => true,
      search: vi.fn().mockRejectedValue(new Error('fail a')),
    };
    const failing2 = {
      name: 'b',
      requiresApiKey: false,
      isAvailable: () => true,
      search: vi.fn().mockRejectedValue(new Error('fail b')),
    };

    await expect(
      searchWithFallback({ primary: failing1, fallbacks: [failing2], source: 'test' }, 'test'),
    ).rejects.toThrow('All search providers failed');
  });
});
