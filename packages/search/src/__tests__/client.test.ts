vi.mock('@agntk/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('duck-duck-scrape', () => ({
  search: vi.fn().mockResolvedValue({
    noResults: false,
    results: [{ title: 'DDG Result', url: 'https://example.com', description: 'A test result' }],
  }),
  SafeSearchType: { STRICT: 0, MODERATE: -1, OFF: -2 },
  SearchTimeType: { DAY: 'd', WEEK: 'w', MONTH: 'm', YEAR: 'y' },
}));

import { createSearchClient } from '../client.js';

const ddg = await import('duck-duck-scrape');
const mockSearch = ddg.search as ReturnType<typeof vi.fn>;

describe('createSearchClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockSearch.mockResolvedValue({
      noResults: false,
      results: [{ title: 'DDG Result', url: 'https://example.com', description: 'A test result' }],
    });
  });

  it('creates a client with default provider', () => {
    const client = createSearchClient();
    const provider = client.getProvider();
    expect(provider.primary.name).toBe('duckduckgo');
  });

  it('search delegates to resolved provider', async () => {
    const client = createSearchClient();
    const response = await client.search('test query');

    expect(response.provider).toBe('duckduckgo');
    expect(response.results).toHaveLength(1);
    expect(response.results[0]!.title).toBe('DDG Result');
  });

  it('search merges default options', async () => {
    const client = createSearchClient({
      defaults: { maxResults: 5, safeSearch: 'strict' },
    });
    const response = await client.search('test');
    expect(response.results.length).toBeLessThanOrEqual(5);
  });

  it('extract fetches URL content', async () => {
    const html =
      '<html><head><title>Test</title></head><body><article>Content</article></body></html>';

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );

    const client = createSearchClient();
    const result = await client.extract('https://example.com');

    expect(result.title).toBe('Test');
    expect(result.content).toContain('Content');
  });
});
