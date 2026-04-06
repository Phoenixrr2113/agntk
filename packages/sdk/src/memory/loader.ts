import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '@agntk/logger';
import { parseFrontmatter } from '../harness/frontmatter';
import type { MemoryStore } from './types';

const log = createLogger('@agntk/core:memory-loader');

const CHARS_PER_TOKEN = 4;
const TOKEN_WARNING_THRESHOLD = 2000;

/**
 * Assembles the persistent-memory block injected into the agent's system
 * prompt at the start of every session.
 *
 * Reads the following sections from the store (each omitted when empty):
 * - **Identity** – global `identity.md`
 * - **Preferences** – global `preferences.md`
 * - **Project** – project-level `project.md` (falls back to `CLAUDE.md` /
 *   `AGENTS.md` in the workspace root)
 * - **Memory Files** – directory listing of `memory/*.md` files
 * - **Current Context** – project-level `context.md` (last session summary)
 *
 * Emits a warning when the assembled context exceeds ~2 000 tokens.
 *
 * @param store - A {@link MemoryStore} implementation that provides the
 *   individual load methods.
 * @returns The formatted memory block string, or an empty string when no
 *   memory content is found.
 */
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

export interface BudgetedLoadOptions {
  tokenBudget?: number;
  taskHint?: string;
  alwaysLoadFull?: string[];
}

interface ScoredFile {
  name: string;
  path: string;
  tags: string[];
  l0: string;
  l1: string;
  score: number;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function scoreRelevance(tags: string[], l0: string, l1: string, hint: string): number {
  if (!hint) return 0;
  const hintTerms = hint.toLowerCase().split(/\s+/).filter(Boolean);
  let score = 0;

  for (const term of hintTerms) {
    for (const tag of tags) {
      if (tag.toLowerCase() === term) score += 3;
      else if (tag.toLowerCase().includes(term)) score += 1.5;
    }
    if (l0.toLowerCase().includes(term)) score += 2;
    if (l1.toLowerCase().includes(term)) score += 1;
  }

  return score;
}

export async function loadMemoryContextWithBudget(
  store: MemoryStore,
  options: BudgetedLoadOptions = {},
): Promise<string> {
  const budget = options.tokenBudget ?? 4000;
  const hint = options.taskHint ?? '';
  const alwaysFull = new Set(options.alwaysLoadFull ?? []);
  let usedTokens = 0;

  const sections: string[] = [];

  const identity = await store.loadIdentity();
  if (identity) {
    sections.push(formatSection('Identity', identity));
    usedTokens += estimateTokens(identity);
  }

  const context = await store.loadContext();
  if (context) {
    sections.push(formatSection('Current Context', context));
    usedTokens += estimateTokens(context);
  }

  const preferences = await store.loadPreferences();
  if (preferences) {
    sections.push(formatSection('Preferences', preferences));
    usedTokens += estimateTokens(preferences);
  }

  const memoryFiles = await store.listMemoryFiles();
  if (memoryFiles.length === 0) {
    if (sections.length === 0) return '';
    return '# Persistent Memory\n\n' + sections.join('\n\n');
  }

  const memoryDir = store.getMemoryPath();
  const l1Budget = Math.floor(budget * 0.7);
  const scored: ScoredFile[] = [];

  for (const fileName of memoryFiles) {
    if (alwaysFull.has(fileName)) continue;

    const filePath = join(memoryDir, fileName);
    if (!existsSync(filePath)) continue;

    try {
      const content = await readFile(filePath, 'utf-8');
      const parsed = parseFrontmatter(content);
      const tags = parsed.frontmatter.tags ?? [];

      scored.push({
        name: fileName,
        path: filePath,
        tags,
        l0: parsed.l0,
        l1: parsed.l1,
        score: scoreRelevance(tags, parsed.l0, parsed.l1, hint),
      });
    } catch {
      scored.push({ name: fileName, path: filePath, tags: [], l0: '', l1: '', score: 0 });
    }
  }

  for (const fullFile of alwaysFull) {
    const filePath = join(memoryDir, fullFile);
    if (!existsSync(filePath)) continue;

    try {
      const content = await readFile(filePath, 'utf-8');
      const tokens = estimateTokens(content);
      usedTokens += tokens;
      sections.push(formatSection(`Memory: ${fullFile}`, content));
    } catch {
      log.warn('Failed to load always-on file', { file: fullFile });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  const l0Lines: string[] = [];
  const l1Loaded: string[] = [];

  for (const file of scored) {
    if (usedTokens >= l1Budget) {
      l0Lines.push(`- ${file.name}${file.l0 ? ` — ${file.l0}` : ''}`);
      continue;
    }

    if (file.l1) {
      const entry = `### ${file.name}\n${file.l1}`;
      const tokens = estimateTokens(entry);

      if (usedTokens + tokens <= l1Budget) {
        l1Loaded.push(entry);
        usedTokens += tokens;
        continue;
      }
    }

    l0Lines.push(`- ${file.name}${file.l0 ? ` — ${file.l0}` : ''}`);
  }

  if (l1Loaded.length > 0) {
    sections.push(formatSection('Memory Summaries', l1Loaded.join('\n\n')));
  }

  if (l0Lines.length > 0) {
    sections.push(
      formatSection(
        'Available Memory Files',
        `These files are available for on-demand reading:\n${l0Lines.join('\n')}`,
      ),
    );
  }

  if (sections.length === 0) return '';

  const result = '# Persistent Memory\n\n' + sections.join('\n\n');

  log.debug('Budgeted memory context loaded', {
    budget,
    usedTokens,
    l1Files: l1Loaded.length,
    l0Files: l0Lines.length,
    totalMemoryFiles: memoryFiles.length,
  });

  return result;
}
