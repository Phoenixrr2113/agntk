vi.mock('@agntk/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('duck-duck-scrape', () => ({
  search: vi.fn(),
  SafeSearchType: { STRICT: 0, MODERATE: -1, OFF: -2 },
  SearchTimeType: { DAY: 'd', WEEK: 'w', MONTH: 'm', YEAR: 'y' },
}));

import { DuckDuckGoProvider } from '../providers/duckduckgo.js';

const ddg = await import('duck-duck-scrape');
const mockSearch = ddg.search as ReturnType<typeof vi.fn>;

describe('DuckDuckGoProvider', () => {
  let provider: DuckDuckGoProvider;

  beforeEach(() => {
    provider = new DuckDuckGoProvider();
    vi.clearAllMocks();
  });

  it('is always available', () => {
    expect(provider.isAvailable()).toBe(true);
  });

  it('has correct name and requiresApiKey', () => {
    expect(provider.name).toBe('duckduckgo');
    expect(provider.requiresApiKey).toBe(false);
  });

  it('returns mapped search results', async () => {
    mockSearch.mockResolvedValueOnce({
      noResults: false,
      results: [
        { title: 'Result 1', url: 'https://example.com/1', description: 'Description 1' },
        { title: 'Result 2', url: 'https://example.com/2', description: 'Description 2' },
      ],
    });

    const response = await provider.search('test query');

    expect(response.provider).toBe('duckduckgo');
    expect(response.query).toBe('test query');
    expect(response.results).toHaveLength(2);
    expect(response.results[0]).toEqual({
      title: 'Result 1',
      url: 'https://example.com/1',
      snippet: 'Description 1',
      source: 'duckduckgo',
    });
    expect(response.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('handles no results', async () => {
    mockSearch.mockResolvedValueOnce({ noResults: true, results: [] });

    const response = await provider.search('nonexistent query');

    expect(response.results).toHaveLength(0);
  });

  it('respects maxResults', async () => {
    mockSearch.mockResolvedValueOnce({
      noResults: false,
      results: Array.from({ length: 20 }, (_, i) => ({
        title: `Result ${i}`,
        url: `https://example.com/${i}`,
        description: `Desc ${i}`,
      })),
    });

    const response = await provider.search('test', { maxResults: 3 });

    expect(response.results).toHaveLength(3);
  });

  it('throws SearchError on failure', async () => {
    mockSearch.mockRejectedValueOnce(new Error('Rate limited'));

    await expect(provider.search('test')).rejects.toThrow('DuckDuckGo search failed: Rate limited');
  });

  it('maps safe search options', async () => {
    mockSearch.mockResolvedValueOnce({ noResults: true, results: [] });

    await provider.search('test', { safeSearch: 'strict' });

    expect(mockSearch).toHaveBeenCalledWith('test', expect.objectContaining({ safeSearch: 0 }));
  });

  it('maps time range options', async () => {
    mockSearch.mockResolvedValueOnce({ noResults: true, results: [] });

    await provider.search('test', { timeRange: 'week' });

    expect(mockSearch).toHaveBeenCalledWith('test', expect.objectContaining({ time: 'w' }));
  });

  it('maps region to locale', async () => {
    mockSearch.mockResolvedValueOnce({ noResults: true, results: [] });

    await provider.search('test', { region: 'US' });

    expect(mockSearch).toHaveBeenCalledWith('test', expect.objectContaining({ locale: 'us' }));
  });

  it('uses rawDescription as fallback snippet', async () => {
    mockSearch.mockResolvedValueOnce({
      noResults: false,
      results: [
        {
          title: 'Result',
          url: 'https://example.com',
          description: '',
          rawDescription: 'Raw desc',
        },
      ],
    });

    const response = await provider.search('test');
    expect(response.results[0]!.snippet).toBe('Raw desc');
  });

  it('retries on anomaly detection error', async () => {
    mockSearch
      .mockRejectedValueOnce(new Error('DDG detected an anomaly in the request'))
      .mockResolvedValueOnce({
        noResults: false,
        results: [{ title: 'OK', url: 'https://ok.com', description: 'Success after retry' }],
      });

    const response = await provider.search('test');

    expect(mockSearch).toHaveBeenCalledTimes(2);
    expect(response.results[0]!.snippet).toBe('Success after retry');
  });

  it('throws after max retries on persistent anomaly', async () => {
    mockSearch.mockRejectedValue(new Error('DDG detected an anomaly in the request'));

    await expect(provider.search('test')).rejects.toThrow('DuckDuckGo search failed');
    expect(mockSearch).toHaveBeenCalledTimes(3);
  });
});
