export type {
  SearchResult,
  SearchResponse,
  SearchOptions,
  SearchProvider,
  SearchProviderConfig,
  SearchConfig,
  ExtractedContent,
  ExtractOptions,
} from './types.js';

export { createSearchClient } from './client.js';
export type { SearchClient } from './client.js';

export { extractContent } from './extract.js';

export { resolveSearchProviders, getAvailableProviders, searchWithFallback } from './resolver.js';
export type { ResolvedSearchProvider } from './resolver.js';

export {
  createDuckDuckGoProvider,
  createSearXNGProvider,
  createTavilyProvider,
  SearchError,
} from './providers/index.js';

export {
  ENV_SEARXNG_URL,
  ENV_TAVILY_API_KEY,
  ENV_SEARCH_PROVIDER,
  PROVIDER_DUCKDUCKGO,
  PROVIDER_SEARXNG,
  PROVIDER_TAVILY,
} from './constants.js';

import { createSearchClient } from './client.js';
import type { SearchClient } from './client.js';
import type { SearchOptions, SearchResponse } from './types.js';

let defaultClient: SearchClient | null = null;

export async function search(query: string, options?: SearchOptions): Promise<SearchResponse> {
  if (!defaultClient) {
    defaultClient = createSearchClient();
  }
  return defaultClient.search(query, options);
}
