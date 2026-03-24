import { createLogger } from '@agntk/logger';
import { DEFAULT_MAX_RESULTS, DEFAULT_TIMEOUT_MS, PROVIDER_DUCKDUCKGO } from '../constants.js';
import type {
  SearchProvider,
  SearchProviderConfig,
  SearchOptions,
  SearchResponse,
  SearchResult,
} from '../types.js';
import { SearchError } from './base.js';

const log = createLogger('@agntk/search:duckduckgo');

const DDG_MAX_RETRIES = 3;
const DDG_RETRY_BASE_DELAY_MS = 1000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DuckDuckGoProvider implements SearchProvider {
  readonly name = PROVIDER_DUCKDUCKGO;
  readonly requiresApiKey = false;

  private readonly config: SearchProviderConfig;

  constructor(config: SearchProviderConfig = {}) {
    this.config = config;
  }

  isAvailable(): boolean {
    return true;
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const maxResults = options.maxResults ?? this.config.maxResults ?? DEFAULT_MAX_RESULTS;
    const timeout = options.timeout ?? this.config.timeout ?? DEFAULT_TIMEOUT_MS;
    const start = Date.now();

    log.debug('searching', { query, maxResults });

    const ddg = await import('duck-duck-scrape');
    const searchFn = ddg.search ?? ddg.default?.search;
    const SafeSearchType = ddg.SafeSearchType ?? ddg.default?.SafeSearchType;
    const SearchTimeType = ddg.SearchTimeType ?? ddg.default?.SearchTimeType;

    if (!searchFn) {
      throw new SearchError('Failed to load duck-duck-scrape search function', this.name);
    }

    const safeSearchMap: Record<string, number> = {
      strict: SafeSearchType?.STRICT ?? 0,
      moderate: SafeSearchType?.MODERATE ?? -1,
      off: SafeSearchType?.OFF ?? -2,
    };

    const timeMap: Record<string, string> = {
      day: SearchTimeType?.DAY ?? 'd',
      week: SearchTimeType?.WEEK ?? 'w',
      month: SearchTimeType?.MONTH ?? 'm',
      year: SearchTimeType?.YEAR ?? 'y',
    };

    const ddgOptions: Record<string, unknown> = {
      safeSearch: safeSearchMap[options.safeSearch ?? 'moderate'],
    };

    if (options.timeRange && timeMap[options.timeRange]) {
      ddgOptions.time = timeMap[options.timeRange];
    }

    if (options.region) {
      ddgOptions.locale = options.region.toLowerCase();
    }

    let lastError: unknown;

    for (let attempt = 0; attempt < DDG_MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const backoff = DDG_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        log.debug('retrying after anomaly detection', { attempt, backoffMs: backoff });
        await delay(backoff);
      }

      try {
        const response = await Promise.race([
          searchFn(query, ddgOptions),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new SearchError(`Timeout after ${timeout}ms`, this.name)),
              timeout,
            ),
          ),
        ]);

        if (response.noResults) {
          log.debug('no results', { query });
          return {
            results: [],
            query,
            provider: this.name,
            durationMs: Date.now() - start,
          };
        }

        const results: SearchResult[] = (response.results ?? [])
          .slice(0, maxResults)
          .map(
            (r: { title: string; url: string; description: string; rawDescription?: string }) => ({
              title: r.title ?? '',
              url: r.url ?? '',
              snippet: r.description || r.rawDescription || '',
              source: this.name,
            }),
          );

        log.debug('search complete', { query, resultCount: results.length, attempt });

        return {
          results,
          query,
          provider: this.name,
          durationMs: Date.now() - start,
        };
      } catch (err: unknown) {
        lastError = err;
        if (err instanceof SearchError) throw err;

        const message = err instanceof Error ? err.message : String(err);
        const isAnomaly = message.includes('anomaly');

        if (!isAnomaly || attempt === DDG_MAX_RETRIES - 1) {
          log.error('search failed', { query, error: message, attempt });
          throw new SearchError(`DuckDuckGo search failed: ${message}`, this.name);
        }

        log.warn('anomaly detected, will retry', { query, attempt });
      }
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new SearchError(
      `DuckDuckGo search failed after ${DDG_MAX_RETRIES} retries: ${message}`,
      this.name,
    );
  }
}

export function createDuckDuckGoProvider(config?: SearchProviderConfig): DuckDuckGoProvider {
  return new DuckDuckGoProvider(config);
}
