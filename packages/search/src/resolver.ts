import { createLogger } from '@agntk/logger';
import {
  DEFAULT_FALLBACK_ORDER,
  ENV_SEARCH_PROVIDER,
  PROVIDER_BRAVE,
  PROVIDER_DUCKDUCKGO,
  PROVIDER_SEARXNG,
  PROVIDER_TAVILY,
} from './constants.js';
import { createBraveProvider } from './providers/brave.js';
import { createDuckDuckGoProvider } from './providers/duckduckgo.js';
import { createSearXNGProvider } from './providers/searxng.js';
import { createTavilyProvider } from './providers/tavily.js';
import { SearchError } from './providers/base.js';
import type { SearchConfig, SearchOptions, SearchProvider, SearchResponse } from './types.js';

const log = createLogger('@agntk/search:resolver');

export interface ResolvedSearchProvider {
  primary: SearchProvider;
  fallbacks: SearchProvider[];
  source: string;
}

function createProviderByName(name: string, config?: SearchConfig): SearchProvider | undefined {
  const providerConfig = config?.providers?.[name] ?? {};

  switch (name) {
    case PROVIDER_BRAVE:
      return createBraveProvider(providerConfig);
    case PROVIDER_DUCKDUCKGO:
      return createDuckDuckGoProvider(providerConfig);
    case PROVIDER_SEARXNG:
      return createSearXNGProvider(providerConfig);
    case PROVIDER_TAVILY:
      return createTavilyProvider(providerConfig);
    default:
      log.warn('unknown provider', { name });
      return undefined;
  }
}

export function getAvailableProviders(config?: SearchConfig): SearchProvider[] {
  const order = config?.fallbackOrder ?? [...DEFAULT_FALLBACK_ORDER];
  const providers: SearchProvider[] = [];

  for (const name of order) {
    const provider = createProviderByName(name, config);
    if (provider?.isAvailable()) {
      providers.push(provider);
    }
  }

  return providers;
}

export function resolveSearchProviders(config?: SearchConfig): ResolvedSearchProvider {
  const explicit = config?.provider ?? process.env[ENV_SEARCH_PROVIDER];

  if (explicit) {
    const provider = createProviderByName(explicit, config);
    if (!provider) {
      throw new SearchError(`Unknown search provider: ${explicit}`, 'resolver');
    }
    if (!provider.isAvailable()) {
      throw new SearchError(
        `Provider "${explicit}" is not available (missing configuration)`,
        'resolver',
      );
    }

    log.debug('explicit provider selected', { provider: explicit });

    const fallbacks = getAvailableProviders(config).filter((p) => p.name !== explicit);

    return {
      primary: provider,
      fallbacks,
      source: 'explicit',
    };
  }

  const available = getAvailableProviders(config);

  if (available.length === 0) {
    throw new SearchError(
      'No search providers available. Install duck-duck-scrape or configure a provider.',
      'resolver',
    );
  }

  const [primary, ...fallbacks] = available;

  if (!primary) {
    throw new SearchError(
      '[agntk] Failed to select a primary search provider from the available list.',
      'resolver',
    );
  }

  log.debug('auto-detected provider', {
    primary: primary.name,
    fallbacks: fallbacks.map((p) => p.name),
  });

  return {
    primary,
    fallbacks,
    source: 'auto',
  };
}

export async function searchWithFallback(
  resolved: ResolvedSearchProvider,
  query: string,
  options?: SearchOptions,
): Promise<SearchResponse> {
  const providers = [resolved.primary, ...resolved.fallbacks];
  const errors: Array<{ provider: string; error: string }> = [];

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i]!;
    const isFallback = i > 0;

    try {
      if (isFallback) {
        log.warn('falling back to provider', { provider: provider.name, previousErrors: errors });
      }

      const response = await provider.search(query, options);

      if (isFallback) {
        response.fallback = true;
      }

      return response;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ provider: provider.name, error: message });
      log.warn('provider failed', { provider: provider.name, error: message });
    }
  }

  throw new SearchError(
    `All search providers failed: ${errors.map((e) => `${e.provider}: ${e.error}`).join('; ')}`,
    'resolver',
  );
}
