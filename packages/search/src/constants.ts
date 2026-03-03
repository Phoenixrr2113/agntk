export const ENV_SEARCH_PROVIDER = 'SEARCH_PROVIDER';
export const ENV_SEARXNG_URL = 'SEARXNG_URL';
export const ENV_TAVILY_API_KEY = 'TAVILY_API_KEY';
export const ENV_BRAVE_API_KEY = 'BRAVE_API_KEY';

export const PROVIDER_DUCKDUCKGO = 'duckduckgo';
export const PROVIDER_SEARXNG = 'searxng';
export const PROVIDER_TAVILY = 'tavily';
export const PROVIDER_BRAVE = 'brave';

export const DEFAULT_MAX_RESULTS = 10;
export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_SAFE_SEARCH: 'off' | 'moderate' | 'strict' = 'moderate';

export const DEFAULT_FALLBACK_ORDER = [
  PROVIDER_DUCKDUCKGO,
  PROVIDER_BRAVE,
  PROVIDER_TAVILY,
  PROVIDER_SEARXNG,
] as const;

export const DEFAULT_MAX_CONTENT_LENGTH = 50_000;
export const DEFAULT_EXTRACT_TIMEOUT_MS = 10_000;
export const CHARS_PER_TOKEN_ESTIMATE = 4;

export const DEFAULT_CONTENT_SELECTORS = [
  'article',
  'main',
  '[role="main"]',
  '.content',
  '#content',
];

export const DEFAULT_REMOVE_SELECTORS = [
  'script',
  'style',
  'noscript',
  'nav',
  'footer',
  'header',
  'aside',
  '.sidebar',
  '.nav',
  '.menu',
  '.ads',
  '.advertisement',
  '.cookie-banner',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="complementary"]',
];
