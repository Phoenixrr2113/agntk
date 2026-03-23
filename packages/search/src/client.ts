import { createLogger } from '@agntk/logger';
import { resolveSearchProviders, searchWithFallback } from './resolver.js';
import { extractContent } from './extract.js';
import type {
  ExtractedContent,
  ExtractOptions,
  SearchConfig,
  SearchOptions,
  SearchResponse,
} from './types.js';
import type { ResolvedSearchProvider } from './resolver.js';

const log = createLogger('@agntk/search:client');

export interface SearchClient {
  search(query: string, options?: SearchOptions): Promise<SearchResponse>;
  searchAndExtract(
    query: string,
    options?: SearchOptions & { extractTop?: number; extractOptions?: ExtractOptions },
  ): Promise<SearchResponse & { extracted: ExtractedContent[] }>;
  extract(url: string, options?: ExtractOptions): Promise<ExtractedContent>;
  getProvider(): ResolvedSearchProvider;
}

export function createSearchClient(config?: SearchConfig): SearchClient {
  const resolved = resolveSearchProviders(config);

  log.debug('client created', {
    primary: resolved.primary.name,
    fallbacks: resolved.fallbacks.map((p) => p.name),
  });

  return {
    async search(query: string, options?: SearchOptions): Promise<SearchResponse> {
      const mergedOptions: SearchOptions = {
        ...config?.defaults,
        ...options,
      };
      return searchWithFallback(resolved, query, mergedOptions);
    },

    async searchAndExtract(
      query: string,
      options?: SearchOptions & { extractTop?: number; extractOptions?: ExtractOptions },
    ): Promise<SearchResponse & { extracted: ExtractedContent[] }> {
      const { extractTop = 3, extractOptions, ...searchOptions } = options ?? {};

      const mergedOptions: SearchOptions = {
        ...config?.defaults,
        ...searchOptions,
      };

      const response = await searchWithFallback(resolved, query, mergedOptions);
      const urls = (response.results ?? []).slice(0, extractTop);

      const extractions = await Promise.allSettled(
        urls.map((r) => extractContent(r.url, extractOptions)),
      );

      const extracted: ExtractedContent[] = [];
      for (const result of extractions) {
        if (result.status === 'fulfilled') {
          extracted.push(result.value);
        } else {
          log.warn('extraction failed', { error: result.reason });
        }
      }

      return { ...response, extracted };
    },

    async extract(url: string, options?: ExtractOptions): Promise<ExtractedContent> {
      return extractContent(url, options);
    },

    getProvider(): ResolvedSearchProvider {
      return resolved;
    },
  };
}
