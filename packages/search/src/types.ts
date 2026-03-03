export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  score?: number;
  publishedDate?: string;
}

export interface SearchOptions {
  maxResults?: number;
  region?: string;
  safeSearch?: 'off' | 'moderate' | 'strict';
  timeRange?: 'day' | 'week' | 'month' | 'year';
  timeout?: number;
}

export interface SearchResponse {
  results: SearchResult[];
  totalResults?: number;
  query: string;
  provider: string;
  durationMs: number;
  fallback?: boolean;
}

export interface SearchProvider {
  readonly name: string;
  readonly requiresApiKey: boolean;
  isAvailable(): boolean;
  search(query: string, options?: SearchOptions): Promise<SearchResponse>;
}

export interface SearchProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
  maxResults?: number;
}

export interface SearchConfig {
  provider?: string;
  providers?: Record<string, SearchProviderConfig>;
  fallbackOrder?: string[];
  defaults?: SearchOptions;
}

export interface ExtractedContent {
  title: string;
  content: string;
  description?: string;
  estimatedTokens: number;
  url: string;
  durationMs: number;
}

export interface ExtractOptions {
  maxLength?: number;
  timeout?: number;
  contentSelectors?: string[];
  removeSelectors?: string[];
}
