import { z } from 'zod';

export const webSearchInputSchema = z.object({
  query: z.string().describe('Search query string'),
  maxResults: z
    .number()
    .min(1)
    .max(20)
    .optional()
    .describe('Maximum number of results to return (default: 10)'),
  timeRange: z
    .enum(['day', 'week', 'month', 'year'])
    .optional()
    .describe('Filter results by recency'),
  extractContent: z
    .boolean()
    .optional()
    .describe('If true, fetch and extract text content from top results'),
  extractTop: z
    .number()
    .min(1)
    .max(5)
    .optional()
    .describe(
      'Number of top results to extract content from (default: 3, requires extractContent)',
    ),
});

export type WebSearchInput = z.infer<typeof webSearchInputSchema>;

export const WEB_SEARCH_DESCRIPTION =
  'Search the web for current information. ' +
  'Returns titles, URLs, and snippets from web search results. ' +
  'Optionally extracts full page content from top results for deeper analysis. ' +
  'Use for up-to-date information, research, and fact-checking.';
