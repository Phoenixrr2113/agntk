import { createLogger } from '@agntk/logger';
import type { MemoryStore } from './types';

const log = createLogger('@agntk/core:memory-loader');

const CHARS_PER_TOKEN = 4;
const TOKEN_WARNING_THRESHOLD = 2000;

export async function loadMemoryContext(store: MemoryStore): Promise<string> {
  const sections: string[] = [];

  const identity = await store.loadIdentity();
  if (identity) {
    sections.push(formatSection('Identity', identity));
  }

  const preferences = await store.loadPreferences();
  if (preferences) {
    sections.push(formatSection('Preferences', preferences));
  }

  const project = await store.loadProject();
  if (project) {
    sections.push(formatSection('Project', project));
  }

  const memoryFiles = await store.listMemoryFiles();
  if (memoryFiles.length > 0) {
    const listing = memoryFiles.map((f) => `- ${f}`).join('\n');
    sections.push(
      formatSection(
        'Memory Files',
        `Your memory/ directory contains these knowledge files:\n${listing}\n\nRead any file when you need its contents. Use grep to search across all files.`,
      ),
    );
  }

  const context = await store.loadContext();
  if (context) {
    sections.push(formatSection('Current Context', context));
  }

  if (sections.length === 0) {
    return '';
  }

  const result = '# Persistent Memory\n\n' + sections.join('\n\n');

  const estimatedTokens = Math.ceil(result.length / CHARS_PER_TOKEN);
  if (estimatedTokens > TOKEN_WARNING_THRESHOLD) {
    log.warn('Memory context is large', {
      estimatedTokens,
      threshold: TOKEN_WARNING_THRESHOLD,
      chars: result.length,
    });
  }

  log.debug('Memory context loaded', {
    sections: sections.length,
    chars: result.length,
    estimatedTokens,
    memoryFileCount: memoryFiles.length,
  });

  return result;
}

function formatSection(title: string, content: string): string {
  return `## ${title}\n\n${content}`;
}
