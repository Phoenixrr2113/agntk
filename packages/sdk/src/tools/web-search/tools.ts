import { tool } from 'ai';
import { createLogger } from '@agntk/logger';
import {
  search,
  extractContent,
  type SearchOptions,
  type SearchResponse,
  type ExtractedContent,
} from '@agntk/search';
import { success, error } from '../utils/tool-result.js';
import { webSearchInputSchema, WEB_SEARCH_DESCRIPTION } from './types.js';

const log = createLogger('@agntk/core:web-search');

function formatSearchOutput(
  response: SearchResponse,
  extracted: Array<{ url: string; title: string; content: string }>,
): string {
  const lines: string[] = [];

  lines.push(`Search: "${response.query}" (${response.provider}, ${response.durationMs}ms)`);
  lines.push('');

  for (let i = 0; i < response.results.length; i++) {
    const r = response.results[i]!;
    lines.push(`${i + 1}. ${r.title}`);
    lines.push(`   ${r.url}`);
    if (r.snippet) {
      lines.push(`   ${r.snippet}`);
    }
    lines.push('');
  }

  if (extracted.length > 0) {
    lines.push('--- Extracted Content ---');
    lines.push('');
    for (const e of extracted) {
      lines.push(`### ${e.title}`);
      lines.push(`Source: ${e.url}`);
      lines.push('');
      lines.push(e.content);
      lines.push('');
    }
  }

  return lines.join('\n');
}

export const webSearchTool = tool({
  description: WEB_SEARCH_DESCRIPTION,
  inputSchema: webSearchInputSchema,
  execute: async (args) => {
    log.debug('web_search execute', { query: args.query, maxResults: args.maxResults });

    try {
      const searchOptions: SearchOptions = {
        maxResults: args.maxResults,
        timeRange: args.timeRange,
      };

      const response = await search(args.query, searchOptions);

      let extracted: Array<{ url: string; title: string; content: string }> = [];

      if (args.extractContent) {
        const top = args.extractTop ?? 3;
        const urls = response.results.slice(0, top);

        const extractions = await Promise.allSettled(
          urls.map((r) => extractContent(r.url, { maxLength: 10_000 })),
        );

        extracted = extractions
          .filter((e): e is PromiseFulfilledResult<ExtractedContent> => e.status === 'fulfilled')
          .map((e) => ({
            url: e.value.url,
            title: e.value.title,
            content: e.value.content,
          }));
      }

      const output = formatSearchOutput(response, extracted);

      log.info('web_search complete', {
        query: args.query,
        results: response.results.length,
        provider: response.provider,
        extracted: extracted.length,
      });

      return success({
        output,
        results: response.results,
        provider: response.provider,
        durationMs: response.durationMs,
        ...(extracted.length > 0 ? { extracted } : {}),
      });
    } catch (err: unknown) {
      log.error('web_search failed', { query: args.query, error: err });
      return error(err instanceof Error ? err.message : String(err));
    }
  },
});

export function createWebSearchTool() {
  return { web_search: webSearchTool };
}
