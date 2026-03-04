# @agntk/search

Multi-provider web search with automatic fallback chain. Works out of the box with DuckDuckGo (no API key needed) and falls back across providers when one fails.

## Installation

```bash
pnpm add @agntk/search
```

## Quick Start

```typescript
import { search } from '@agntk/search';

const response = await search('node.js best practices 2026');
console.log(response.results); // [{ title, url, snippet, source }]
console.log(response.provider); // 'duckduckgo'
```

## Search Client

For more control, create a client with custom configuration:

```typescript
import { createSearchClient } from '@agntk/search';

const client = createSearchClient({
  provider: 'tavily', // explicit provider
  defaults: { maxResults: 5, safeSearch: 'strict' },
});

// Search
const results = await client.search('AI agent frameworks');

// Search + extract page content
const { results, extracted } = await client.searchAndExtract('typescript patterns', {
  extractTop: 3, // extract content from top 3 results
});

// Extract a single URL
const content = await client.extract('https://example.com/article');
console.log(content.content); // cleaned text
console.log(content.estimatedTokens); // ~token count
```

## Providers

Providers are auto-detected based on available API keys and resolved in fallback order:

| Provider   | API Key Required | Env Variable     | Default Priority |
| ---------- | ---------------- | ---------------- | ---------------- |
| DuckDuckGo | No               | —                | 1st              |
| Brave      | Yes              | `BRAVE_API_KEY`  | 2nd              |
| Tavily     | Yes              | `TAVILY_API_KEY` | 3rd              |
| SearXNG    | No (self-hosted) | `SEARXNG_URL`    | 4th              |

Force a specific provider:

```bash
export SEARCH_PROVIDER=tavily
export TAVILY_API_KEY=tvly-...
```

Or configure programmatically:

```typescript
const client = createSearchClient({
  provider: 'brave',
  providers: {
    brave: { apiKey: 'BSA...' },
  },
});
```

## Search Options

```typescript
interface SearchOptions {
  maxResults?: number; // default: 10
  region?: string; // e.g. 'us-en'
  safeSearch?: 'off' | 'moderate' | 'strict'; // default: 'moderate'
  timeRange?: 'day' | 'week' | 'month' | 'year';
  timeout?: number; // default: 15000ms
}
```

## Content Extraction

Extract and clean page content from any URL:

```typescript
import { extractContent } from '@agntk/search';

const page = await extractContent('https://example.com/docs', {
  maxLength: 50000, // max characters (default: 50000)
  timeout: 10000, // fetch timeout ms
});

console.log(page.title);
console.log(page.content); // cleaned text, scripts/nav/ads removed
console.log(page.estimatedTokens);
```

## Exports

| Export Path               | Contents                                                                    |
| ------------------------- | --------------------------------------------------------------------------- |
| `@agntk/search`           | `search`, `createSearchClient`, `extractContent`, provider factories, types |
| `@agntk/search/providers` | Individual provider factories                                               |
| `@agntk/search/extract`   | `extractContent` standalone                                                 |

## License

MIT
