import { load } from 'cheerio';
import { createLogger } from '@agntk/logger';
import {
  CHARS_PER_TOKEN_ESTIMATE,
  DEFAULT_CONTENT_SELECTORS,
  DEFAULT_EXTRACT_TIMEOUT_MS,
  DEFAULT_MAX_CONTENT_LENGTH,
  DEFAULT_REMOVE_SELECTORS,
} from './constants.js';
import { fetchWithTimeout, SearchError } from './providers/base.js';
import type { ExtractedContent, ExtractOptions } from './types.js';

const log = createLogger('@agntk/search:extract');

export async function extractContent(
  url: string,
  options: ExtractOptions = {},
): Promise<ExtractedContent> {
  const {
    maxLength = DEFAULT_MAX_CONTENT_LENGTH,
    timeout = DEFAULT_EXTRACT_TIMEOUT_MS,
    contentSelectors = DEFAULT_CONTENT_SELECTORS,
    removeSelectors = DEFAULT_REMOVE_SELECTORS,
  } = options;

  const start = Date.now();

  log.debug('extracting', { url, maxLength });

  const response = await fetchWithTimeout(url, {
    timeout,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; agntk-search/1.0)',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  if (!response.ok) {
    throw new SearchError(
      `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
      'extract',
      response.status,
    );
  }

  const contentType = response.headers.get('content-type') ?? '';
  const body = await response.text();

  if (!contentType.includes('html')) {
    const content = body.slice(0, maxLength);
    return {
      title: url,
      content,
      url,
      estimatedTokens: Math.ceil(content.length / CHARS_PER_TOKEN_ESTIMATE),
      durationMs: Date.now() - start,
    };
  }

  const $ = load(body);

  for (const selector of removeSelectors) {
    $(selector).remove();
  }

  const title = $('title').first().text().trim() || $('h1').first().text().trim() || url;

  const description =
    $('meta[name="description"]').attr('content')?.trim() ??
    $('meta[property="og:description"]').attr('content')?.trim();

  let content = '';

  for (const selector of contentSelectors) {
    const el = $(selector).first();
    if (el.length > 0) {
      content = el.text();
      break;
    }
  }

  if (!content) {
    content = $('body').text();
  }

  content = content.replace(/\s+/g, ' ').trim();

  if (content.length > maxLength) {
    const truncated = content.slice(0, maxLength);
    const lastSentence = truncated.lastIndexOf('.');
    content = lastSentence > maxLength * 0.8 ? truncated.slice(0, lastSentence + 1) : truncated;
  }

  log.debug('extraction complete', {
    url,
    contentLength: content.length,
    title,
  });

  return {
    title,
    content,
    description,
    url,
    estimatedTokens: Math.ceil(content.length / CHARS_PER_TOKEN_ESTIMATE),
    durationMs: Date.now() - start,
  };
}
