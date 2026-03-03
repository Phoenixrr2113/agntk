import { createLogger } from '@agntk/logger';
import {
  DEFAULT_MAX_RESULTS,
  DEFAULT_TIMEOUT_MS,
  ENV_TAVILY_API_KEY,
  PROVIDER_TAVILY,
} from '../constants.js';
import type {
  SearchProvider,
  SearchProviderConfig,
  SearchOptions,
  SearchResponse,
  SearchResult,
} from '../types.js';
import { SearchError, fetchWithTimeout } from './base.js';

const log = createLogger('@agntk/search:tavily');

const TAVILY_API_URL = 'https://api.tavily.com/search';

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score?: number;
  published_date?: string;
}

interface TavilyResponse {
  results: TavilyResult[];
  query: string;
}

export class TavilyProvider implements SearchProvider {
  readonly name = PROVIDER_TAVILY;
  readonly requiresApiKey = true;

  private readonly config: SearchProviderConfig;

  constructor(config: SearchProviderConfig = {}) {
    this.config = config;
  }

  private getApiKey(): string | undefined {
    return this.config.apiKey ?? process.env[ENV_TAVILY_API_KEY];
  }

  isAvailable(): boolean {
    return !!this.getApiKey();
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new SearchError('TAVILY_API_KEY is not configured', this.name);
    }

    const maxResults = options.maxResults ?? this.config.maxResults ?? DEFAULT_MAX_RESULTS;
    const timeout = options.timeout ?? this.config.timeout ?? DEFAULT_TIMEOUT_MS;
    const start = Date.now();

    log.debug('searching', { query, maxResults });

    const body: Record<string, unknown> = {
      query,
      max_results: maxResults,
      search_depth: 'basic',
    };

    if (options.timeRange) {
      const dayMap: Record<string, number> = {
        day: 1,
        week: 7,
        month: 30,
        year: 365,
      };
      if (dayMap[options.timeRange] !== undefined) {
        body.days = dayMap[options.timeRange];
      }
    }

    const url = this.config.baseUrl ?? TAVILY_API_URL;

    try {
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        timeout,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        throw new SearchError(
          `Tavily returned ${response.status}: ${errorText}`,
          this.name,
          response.status,
        );
      }

      const data = (await response.json()) as TavilyResponse;

      const results: SearchResult[] = (data.results ?? []).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.content ?? '',
        source: this.name,
        score: r.score,
        publishedDate: r.published_date,
      }));

      log.debug('search complete', { query, resultCount: results.length });

      return {
        results,
        query,
        provider: this.name,
        durationMs: Date.now() - start,
      };
    } catch (err: unknown) {
      if (err instanceof SearchError) throw err;

      const message = err instanceof Error ? err.message : String(err);
      log.error('search failed', { query, error: message });
      throw new SearchError(`Tavily search failed: ${message}`, this.name);
    }
  }
}

export function createTavilyProvider(config?: SearchProviderConfig): TavilyProvider {
  return new TavilyProvider(config);
}
