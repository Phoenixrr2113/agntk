vi.mock('@agntk/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { BraveProvider } from '../providers/brave.js';

describe('BraveProvider', () => {
  let provider: BraveProvider;
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
    it('is not available without BRAVE_API_KEY', () => {
      delete process.env.BRAVE_API_KEY;
      provider = new BraveProvider();
      expect(provider.isAvailable()).toBe(false);
    });

    it('is available with BRAVE_API_KEY', () => {
      process.env.BRAVE_API_KEY = 'test-brave-key';
      provider = new BraveProvider();
      expect(provider.isAvailable()).toBe(true);
    });

    it('is available with config apiKey', () => {
      provider = new BraveProvider({ apiKey: 'test-brave-key' });
      expect(provider.isAvailable()).toBe(true);
    });
  });

  describe('search', () => {
    beforeEach(() => {
      provider = new BraveProvider({ apiKey: 'test-brave-key' });
    });

    it('returns mapped results', async () => {
      const mockResponse = {
        web: {
          results: [
            {
              title: 'Brave Result',
              url: 'https://example.com',
              description: 'Brave search description',
              page_age: '2025-06-15T10:00:00',
              age: 'June 15, 2025',
            },
          ],
        },
        query: { original: 'test' },
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      const response = await provider.search('test query');

      expect(response.provider).toBe('brave');
      expect(response.results).toHaveLength(1);
      expect(response.results[0]).toEqual({
        title: 'Brave Result',
        url: 'https://example.com',
        snippet: 'Brave search description',
        source: 'brave',
        publishedDate: '2025-06-15T10:00:00',
      });
    });

    it('sends correct GET request with auth header', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ web: { results: [] } }), { status: 200 }),
      );

      await provider.search('test query', { maxResults: 5 });

      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0]!;
      const url = fetchCall[0] as string;
      const init = fetchCall[1] as RequestInit;

      expect(init.method).toBe('GET');
      expect(url).toContain('q=test+query');
      expect(url).toContain('count=5');

      const headers = init.headers as Record<string, string>;
      expect(headers['X-Subscription-Token']).toBe('test-brave-key');
      expect(headers.Accept).toBe('application/json');
    });

    it('passes freshness and safesearch params', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ web: { results: [] } }), { status: 200 }),
      );

      await provider.search('test', { timeRange: 'week', safeSearch: 'strict' });

      const url = vi.mocked(globalThis.fetch).mock.calls[0]![0] as string;
      expect(url).toContain('freshness=pw');
      expect(url).toContain('safesearch=strict');
    });

    it('passes country param for region', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ web: { results: [] } }), { status: 200 }),
      );

      await provider.search('test', { region: 'us' });

      const url = vi.mocked(globalThis.fetch).mock.calls[0]![0] as string;
      expect(url).toContain('country=US');
    });

    it('falls back to age when page_age is missing', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            web: {
              results: [{ title: 'T', url: 'https://x.com', description: 'D', age: 'Jan 1, 2025' }],
            },
          }),
          { status: 200 },
        ),
      );

      const response = await provider.search('test');
      expect(response.results[0]!.publishedDate).toBe('Jan 1, 2025');
    });

    it('handles empty web results', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({}), { status: 200 }),
      );

      const response = await provider.search('obscure query');
      expect(response.results).toHaveLength(0);
    });

    it('throws on HTTP error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }),
      );

      await expect(provider.search('test')).rejects.toThrow('Brave returned 401');
    });

    it('throws when API key not configured', async () => {
      const unconfigured = new BraveProvider();
      delete process.env.BRAVE_API_KEY;
      await expect(unconfigured.search('test')).rejects.toThrow('BRAVE_API_KEY is not configured');
    });
  });
});
