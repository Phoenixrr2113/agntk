import { tool } from 'ai';
import { z } from 'zod';
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createLogger } from '@agntk/logger';
import { success, error } from '../tools/utils/tool-result';

const log = createLogger('@agntk/core:harness-instinct-writer');

export interface InstinctWriterConfig {
  harnessRoot: string;
}

function generateInstinctId(): string {
  const timestamp = Date.now().toString(36);
  const random = randomUUID().slice(0, 8);
  return `instinct-${timestamp}-${random}`;
}

function buildInstinctContent(id: string, text: string, tags: string[], source: string): string {
  const now = new Date().toISOString().split('T')[0];
  const firstSentence = text.split(/[.!?\n]/)[0].trim();
  const l0 = firstSentence.length > 80 ? firstSentence.slice(0, 77) + '...' : firstSentence;

  const lines = [
    '---',
    `id: ${id}`,
    `tags: [${tags.join(', ')}]`,
    `created: ${now}`,
    `updated: ${now}`,
    `author: agent`,
    `status: draft`,
    `source: ${source}`,
    '---',
    `<!-- L0: ${l0} -->`,
    `<!-- L1: ${text.length > 200 ? text.slice(0, 200) + '...' : text} -->`,
    text,
  ];

  return lines.join('\n');
}

const instinctSchema = z.object({
  text: z.string().describe('The instinct content — what was learned and how to apply it'),
  tags: z.array(z.string()).describe('Categorization tags (e.g., ["error-handling", "api"])'),
  source: z.string().describe('Session or context identifier for provenance tracking'),
});

export function createInstinctTool(config: InstinctWriterConfig) {
  const instinctsDir = join(config.harnessRoot, 'instincts');

  return tool({
    description:
      'Create a new instinct file capturing a learned behavior or pattern. ' +
      'Use this when you discover something through experience that should ' +
      'inform future sessions — e.g., a surprising failure mode, a validated ' +
      'approach, or a recurring user preference.',
    inputSchema: instinctSchema,
    execute: async ({ text, tags, source }) => {
      try {
        if (!existsSync(instinctsDir)) {
          await mkdir(instinctsDir, { recursive: true });
        }

        const id = generateInstinctId();
        const content = buildInstinctContent(id, text, tags, source);
        const filePath = join(instinctsDir, `${id}.md`);

        await writeFile(filePath, content, 'utf-8');

        log.info('Instinct created', { id, path: filePath, tags });

        return success({ path: filePath, id }, `Instinct "${id}" created successfully.`);
      } catch (err) {
        log.warn('Failed to create instinct', {
          error: err instanceof Error ? err.message : String(err),
        });
        return error(err instanceof Error ? err : String(err));
      }
    },
  });
}
