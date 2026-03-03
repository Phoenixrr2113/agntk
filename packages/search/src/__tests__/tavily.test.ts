vi.mock('@agntk/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { TavilyProvider } from '../providers/tavily.js';

describe('TavilyProvider', () => {
  let provider: TavilyProvider;
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
    it('is not available without TAVILY_API_KEY', () => {
      delete process.env.TAVILY_API_KEY;
      provider = new TavilyProvider();
      expect(provider.isAvailable()).toBe(false);
    });

    it('is available with TAVILY_API_KEY', () => {
      process.env.TAVILY_API_KEY = 'test-key';
      provider = new TavilyProvider();
      expect(provider.isAvailable()).toBe(true);
    });

    it('is available with config apiKey', () => {
      provider = new TavilyProvider({ apiKey: 'test-key' });
      expect(provider.isAvailable()).toBe(true);
    });
  });

  describe('search', () => {
    beforeEach(() => {
      provider = new TavilyProvider({ apiKey: 'test-key' });
    });

    it('returns mapped results', async () => {
      const mockResponse = {
        results: [
          {
            title: 'Tavily Result',
            url: 'https://example.com',
            content: 'AI search content',
            score: 0.95,
            published_date: '2025-01-15',
          },
        ],
        query: 'test',
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      const response = await provider.search('test query');

      expect(response.provider).toBe('tavily');
      expect(response.results).toHaveLength(1);
      expect(response.results[0]).toEqual({
        title: 'Tavily Result',
        url: 'https://example.com',
        snippet: 'AI search content',
        source: 'tavily',
        score: 0.95,
        publishedDate: '2025-01-15',
      });
    });

    it('sends correct POST body', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [] }), { status: 200 }),
      );

      await provider.search('test query', { maxResults: 5 });

      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0]!;
      const init = fetchCall[1] as RequestInit;
      expect(init.method).toBe('POST');

      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer test-key');

      const body = JSON.parse(init.body as string);
      expect(body.api_key).toBeUndefined();
      expect(body.query).toBe('test query');
      expect(body.max_results).toBe(5);
      expect(body.search_depth).toBe('basic');
    });

    it('throws on HTTP error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }),
      );

      await expect(provider.search('test')).rejects.toThrow('Tavily returned 401');
    });

    it('sends timeRange as integer days', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [] }), { status: 200 }),
      );

      await provider.search('test', { timeRange: 'week' });

      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0]!;
      const body = JSON.parse((fetchCall[1] as RequestInit).body as string);
      expect(body.days).toBe(7);
    });

    it('sends correct days for all time ranges', async () => {
      const ranges = { day: 1, week: 7, month: 30, year: 365 };

      for (const [range, expected] of Object.entries(ranges)) {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
          new Response(JSON.stringify({ results: [] }), { status: 200 }),
        );

        await provider.search('test', { timeRange: range as 'day' | 'week' | 'month' | 'year' });

        const fetchCall = vi.mocked(globalThis.fetch).mock.calls.at(-1)!;
        const body = JSON.parse((fetchCall[1] as RequestInit).body as string);
        expect(body.days).toBe(expected);
      }
    });

    it('throws when API key not configured', async () => {
      const unconfigured = new TavilyProvider();
      delete process.env.TAVILY_API_KEY;
      await expect(unconfigured.search('test')).rejects.toThrow('TAVILY_API_KEY is not configured');
    });
  });
});
