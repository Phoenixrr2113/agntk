import { createLogger } from '@agntk/logger';
import {
  DEFAULT_MAX_RESULTS,
  DEFAULT_TIMEOUT_MS,
  ENV_BRAVE_API_KEY,
  PROVIDER_BRAVE,
} from '../constants.js';
import type {
  SearchProvider,
  SearchProviderConfig,
  SearchOptions,
  SearchResponse,
  SearchResult,
} from '../types.js';
import { SearchError, fetchWithTimeout } from './base.js';

const log = createLogger('@agntk/search:brave');

const BRAVE_API_URL = 'https://api.search.brave.com/res/v1/web/search';

interface BraveWebResult {
  title: string;
  url: string;
  description: string;
  page_age?: string;
  age?: string;
}

interface BraveSearchResponse {
  web?: {
    results: BraveWebResult[];
  };
  query?: {
    original: string;
  };
}

export class BraveProvider implements SearchProvider {
  readonly name = PROVIDER_BRAVE;
  readonly requiresApiKey = true;

  private readonly config: SearchProviderConfig;

  constructor(config: SearchProviderConfig = {}) {
    this.config = config;
  }

  private getApiKey(): string | undefined {
    return this.config.apiKey ?? process.env[ENV_BRAVE_API_KEY];
  }

  isAvailable(): boolean {
    return !!this.getApiKey();
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new SearchError('BRAVE_API_KEY is not configured', this.name);
    }

    const maxResults = options.maxResults ?? this.config.maxResults ?? DEFAULT_MAX_RESULTS;
    const timeout = options.timeout ?? this.config.timeout ?? DEFAULT_TIMEOUT_MS;
    const start = Date.now();

    log.debug('searching', { query, maxResults });

    const params = new URLSearchParams({
      q: query,
      count: String(maxResults),
    });

    if (options.timeRange) {
      const freshnessMap: Record<string, string> = {
        day: 'pd',
        week: 'pw',
        month: 'pm',
        year: 'py',
      };
      if (freshnessMap[options.timeRange]) {
        params.set('freshness', freshnessMap[options.timeRange]!);
      }
    }

    if (options.safeSearch) {
      const safeMap: Record<string, string> = {
        strict: 'strict',
        moderate: 'moderate',
        off: 'off',
      };
      if (safeMap[options.safeSearch]) {
        params.set('safesearch', safeMap[options.safeSearch]!);
      }
    }

    if (options.region) {
      params.set('country', options.region.toUpperCase());
    }

    const baseUrl = this.config.baseUrl ?? BRAVE_API_URL;
    const url = `${baseUrl}?${params.toString()}`;

    try {
      const response = await fetchWithTimeout(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': apiKey,
        },
        timeout,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        throw new SearchError(
          `Brave returned ${response.status}: ${errorText}`,
          this.name,
          response.status,
        );
      }

      const data = (await response.json()) as BraveSearchResponse;

      const results: SearchResult[] = (data.web?.results ?? []).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.description ?? '',
        source: this.name,
        publishedDate: r.page_age ?? r.age,
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
      throw new SearchError(`Brave search failed: ${message}`, this.name);
    }
  }
}

export function createBraveProvider(config?: SearchProviderConfig): BraveProvider {
  return new BraveProvider(config);
}
