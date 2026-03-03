vi.mock('@agntk/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { SearXNGProvider } from '../providers/searxng.js';

describe('SearXNGProvider', () => {
  let provider: SearXNGProvider;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('availability', () => {
    it('is not available without SEARXNG_URL', () => {
      delete process.env.SEARXNG_URL;
      provider = new SearXNGProvider();
      expect(provider.isAvailable()).toBe(false);
    });

    it('is available with SEARXNG_URL', () => {
      process.env.SEARXNG_URL = 'http://localhost:8080';
      provider = new SearXNGProvider();
      expect(provider.isAvailable()).toBe(true);
    });

    it('is available with config baseUrl', () => {
      provider = new SearXNGProvider({ baseUrl: 'http://searxng.local' });
      expect(provider.isAvailable()).toBe(true);
    });
  });

  describe('search', () => {
    beforeEach(() => {
      provider = new SearXNGProvider({ baseUrl: 'http://localhost:8080' });
    });

    it('returns mapped results', async () => {
      const mockResponse = {
        results: [
          {
            title: 'Test',
            url: 'https://example.com',
            content: 'A snippet',
            engine: 'google',
            score: 0.9,
          },
        ],
        number_of_results: 100,
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      const response = await provider.search('test query');

      expect(response.provider).toBe('searxng');
      expect(response.results).toHaveLength(1);
      expect(response.results[0]).toEqual({
        title: 'Test',
        url: 'https://example.com',
        snippet: 'A snippet',
        source: 'searxng',
        score: 0.9,
        publishedDate: undefined,
      });
      expect(response.totalResults).toBe(100);
    });

    it('builds correct URL with params', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [] }), { status: 200 }),
      );

      await provider.search('test', { timeRange: 'week', safeSearch: 'strict' });

      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0]!;
      const url = fetchCall[0] as string;
      expect(url).toContain('q=test');
      expect(url).toContain('format=json');
      expect(url).toContain('time_range=week');
      expect(url).toContain('safesearch=2');
    });

    it('throws on HTTP error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Server Error', { status: 500, statusText: 'Internal Server Error' }),
      );

      await expect(provider.search('test')).rejects.toThrow('SearXNG returned 500');
    });

    it('throws when URL not configured', async () => {
      const unconfigured = new SearXNGProvider();
      delete process.env.SEARXNG_URL;
      await expect(unconfigured.search('test')).rejects.toThrow('SEARXNG_URL is not configured');
    });
  });
});
