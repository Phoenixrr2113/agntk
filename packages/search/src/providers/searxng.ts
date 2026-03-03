import { createLogger } from '@agntk/logger';
import {
  DEFAULT_MAX_RESULTS,
  DEFAULT_TIMEOUT_MS,
  ENV_SEARXNG_URL,
  PROVIDER_SEARXNG,
} from '../constants.js';
import type {
  SearchProvider,
  SearchProviderConfig,
  SearchOptions,
  SearchResponse,
  SearchResult,
} from '../types.js';
import { SearchError, fetchWithTimeout } from './base.js';

const log = createLogger('@agntk/search:searxng');

interface SearXNGResult {
  title: string;
  url: string;
  content?: string;
  engine: string;
  score?: number;
  publishedDate?: string;
}

interface SearXNGResponse {
  results: SearXNGResult[];
  number_of_results?: number;
}

/**
 * SearXNG search provider — self-hosted meta-search engine.
 *
 * Requires a running SearXNG instance with JSON API enabled.
 * Set the `SEARXNG_URL` environment variable to your instance URL.
 *
 * Quick setup with Docker:
 * ```bash
 * docker run --name searxng -d -p 8888:8080 docker.io/searxng/searxng:latest
 * ```
 *
 * Then enable the JSON API in `<volume>/config/settings.yml`:
 * ```yaml
 * search:
 *   formats:
 *     - html
 *     - json
 * ```
 *
 * Finally set the env var:
 * ```
 * SEARXNG_URL=http://localhost:8888
 * ```
 *
 * Full docs: https://docs.searxng.org/admin/installation-docker.html
 * API reference: https://docs.searxng.org/dev/search_api.html
 */
export class SearXNGProvider implements SearchProvider {
  readonly name = PROVIDER_SEARXNG;
  readonly requiresApiKey = false;

  private readonly config: SearchProviderConfig;

  constructor(config: SearchProviderConfig = {}) {
    this.config = config;
  }

  private getBaseUrl(): string | undefined {
    return this.config.baseUrl ?? process.env[ENV_SEARXNG_URL];
  }

  isAvailable(): boolean {
    return !!this.getBaseUrl();
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const baseUrl = this.getBaseUrl();
    if (!baseUrl) {
      throw new SearchError('SEARXNG_URL is not configured', this.name);
    }

    const maxResults = options.maxResults ?? this.config.maxResults ?? DEFAULT_MAX_RESULTS;
    const timeout = options.timeout ?? this.config.timeout ?? DEFAULT_TIMEOUT_MS;
    const start = Date.now();

    log.debug('searching', { query, baseUrl, maxResults });

    const params = new URLSearchParams({
      q: query,
      format: 'json',
      categories: 'general',
    });

    if (options.timeRange) {
      const timeMap: Record<string, string> = {
        day: 'day',
        week: 'week',
        month: 'month',
        year: 'year',
      };
      if (timeMap[options.timeRange]) {
        params.set('time_range', timeMap[options.timeRange]);
      }
    }

    if (options.region) {
      params.set('language', options.region.split('-')[0] ?? options.region);
    }

    if (options.safeSearch) {
      const safeMap: Record<string, string> = {
        off: '0',
        moderate: '1',
        strict: '2',
      };
      params.set('safesearch', safeMap[options.safeSearch] ?? '1');
    }

    const url = `${baseUrl.replace(/\/$/, '')}/search?${params.toString()}`;

    try {
      const response = await fetchWithTimeout(url, { timeout });

      if (!response.ok) {
        throw new SearchError(
          `SearXNG returned ${response.status}: ${response.statusText}`,
          this.name,
          response.status,
        );
      }

      const data = (await response.json()) as SearXNGResponse;

      const results: SearchResult[] = (data.results ?? []).slice(0, maxResults).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.content ?? '',
        source: this.name,
        score: r.score,
        publishedDate: r.publishedDate,
      }));

      log.debug('search complete', { query, resultCount: results.length });

      return {
        results,
        totalResults: data.number_of_results,
        query,
        provider: this.name,
        durationMs: Date.now() - start,
      };
    } catch (err: unknown) {
      if (err instanceof SearchError) throw err;

      const message = err instanceof Error ? err.message : String(err);
      log.error('search failed', { query, error: message });
      throw new SearchError(`SearXNG search failed: ${message}`, this.name);
    }
  }
}

export function createSearXNGProvider(config?: SearchProviderConfig): SearXNGProvider {
  return new SearXNGProvider(config);
}
