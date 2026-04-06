import { readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '@agntk/logger';
import { parseFrontmatter } from './frontmatter';

const log = createLogger('@agntk/core:harness-index-builder');

const INDEX_FILENAME = '_index.md';

interface IndexEntry {
  filename: string;
  id: string;
  tags: string[];
  l0: string;
  status: string;
  updated: string;
}

export async function buildIndex(dirPath: string): Promise<string> {
  if (!existsSync(dirPath)) return '';

  const entries: IndexEntry[] = [];
  const files = await readdir(dirPath);
  const mdFiles = files.filter((f) => f.endsWith('.md') && f !== INDEX_FILENAME);

  for (const file of mdFiles) {
    try {
      const content = await readFile(join(dirPath, file), 'utf-8');
      const parsed = parseFrontmatter(content);
      const fm = parsed.frontmatter;

      let updated = fm.updated ?? '';
      if (!updated) {
        try {
          const fileStat = await stat(join(dirPath, file));
          updated = fileStat.mtime.toISOString().split('T')[0];
        } catch {
          updated = '';
        }
      }

      entries.push({
        filename: file,
        id: fm.id ?? file.replace(/\.md$/, ''),
        tags: fm.tags ?? [],
        l0: parsed.l0 || (parsed.l1 ? parsed.l1.slice(0, 60) : ''),
        status: fm.status ?? 'active',
        updated,
      });
    } catch (err) {
      log.warn('Failed to parse file for index', {
        file,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  entries.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));

  const lines = [
    `# Index — ${dirPath.split('/').pop()}`,
    '',
    `> Auto-generated. ${entries.length} file(s). Do not edit manually.`,
    '',
    '| File | ID | Tags | Summary | Status | Updated |',
    '|------|-----|------|---------|--------|---------|',
  ];

  for (const entry of entries) {
    lines.push(
      `| ${entry.filename} | ${entry.id} | ${entry.tags.join(', ')} | ${entry.l0} | ${entry.status} | ${entry.updated} |`,
    );
  }

  return lines.join('\n') + '\n';
}

export async function rebuildAllIndexes(harnessRoot: string): Promise<void> {
  const dirs = ['rules', 'instincts', 'memory'];

  for (const dir of dirs) {
    const dirPath = join(harnessRoot, dir);
    if (!existsSync(dirPath)) continue;

    try {
      const content = await buildIndex(dirPath);
      if (content) {
        await writeFile(join(dirPath, INDEX_FILENAME), content, 'utf-8');
        log.debug('Index rebuilt', { dir: dirPath });
      }
    } catch (err) {
      log.warn('Failed to rebuild index', {
        dir: dirPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
