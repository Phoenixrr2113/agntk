import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '@agntk/logger';
import { parseFrontmatter } from './frontmatter';
import type { CoreIdentity, Rule, Instinct, HarnessFrontmatter } from './types';

const log = createLogger('@agntk/core:harness-governance');

const CORE_FILE = 'core.md';
const RULES_DIR = 'rules';
const INSTINCTS_DIR = 'instincts';

function buildFullFrontmatter(
  partial: Partial<HarnessFrontmatter>,
  filename: string,
): HarnessFrontmatter {
  return {
    id: partial.id ?? filename.replace(/\.md$/, ''),
    tags: partial.tags ?? [],
    created: partial.created ?? '',
    updated: partial.updated ?? '',
    author: partial.author ?? 'unknown',
    status: partial.status ?? 'active',
    source: partial.source,
    related: partial.related,
  };
}

function parseCoreIdentity(body: string): CoreIdentity {
  const sections: Record<string, string> = {};
  let currentKey = '';

  for (const line of body.split('\n')) {
    const headerMatch = line.match(/^##\s+(.+)/);
    if (headerMatch) {
      currentKey = headerMatch[1].toLowerCase().trim();
      continue;
    }
    if (currentKey) {
      sections[currentKey] = ((sections[currentKey] ?? '') + '\n' + line).trim();
    }
  }

  const parseList = (text: string | undefined): string[] =>
    (text ?? '')
      .split('\n')
      .map((l) => l.replace(/^[-*]\s*/, '').trim())
      .filter(Boolean);

  return {
    purpose: sections['purpose'] ?? '',
    creator: sections['creator'] ?? '',
    values: parseList(sections['values']),
    ethics: parseList(sections['ethics']),
    identity: sections['identity'] ?? '',
  };
}

async function loadMarkdownFiles(dirPath: string): Promise<Array<{ name: string; content: string }>> {
  if (!existsSync(dirPath)) return [];

  try {
    const entries = await readdir(dirPath);
    const mdFiles = entries.filter((e) => e.endsWith('.md') && !e.startsWith('_'));
    const results: Array<{ name: string; content: string }> = [];

    for (const file of mdFiles) {
      try {
        const content = await readFile(join(dirPath, file), 'utf-8');
        results.push({ name: file, content });
      } catch (err) {
        log.warn('Failed to read harness file', {
          path: join(dirPath, file),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return results;
  } catch (err) {
    log.warn('Failed to read harness directory', {
      path: dirPath,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

export interface GovernanceLoader {
  loadCore(): Promise<CoreIdentity | null>;
  loadRules(): Promise<Rule[]>;
  loadInstincts(): Promise<Instinct[]>;
  buildGovernancePrompt(): Promise<string>;
}

export function createGovernanceLoader(harnessRoot: string): GovernanceLoader {
  return {
    async loadCore(): Promise<CoreIdentity | null> {
      const corePath = join(harnessRoot, CORE_FILE);
      if (!existsSync(corePath)) {
        log.debug('No core.md found', { path: corePath });
        return null;
      }

      try {
        const content = await readFile(corePath, 'utf-8');
        const parsed = parseFrontmatter(content);
        return parseCoreIdentity(parsed.body);
      } catch (err) {
        log.warn('Failed to parse core.md', {
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    },

    async loadRules(): Promise<Rule[]> {
      const files = await loadMarkdownFiles(join(harnessRoot, RULES_DIR));
      const rules: Rule[] = [];

      for (const file of files) {
        try {
          const parsed = parseFrontmatter(file.content);
          const frontmatter = buildFullFrontmatter(parsed.frontmatter, file.name);

          if (frontmatter.status === 'archived') continue;

          rules.push({
            frontmatter,
            l0: parsed.l0,
            l1: parsed.l1,
            body: parsed.body,
          });
        } catch (err) {
          log.warn('Failed to parse rule', {
            file: file.name,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return rules;
    },

    async loadInstincts(): Promise<Instinct[]> {
      const files = await loadMarkdownFiles(join(harnessRoot, INSTINCTS_DIR));
      const instincts: Instinct[] = [];

      for (const file of files) {
        try {
          const parsed = parseFrontmatter(file.content);
          const frontmatter = buildFullFrontmatter(parsed.frontmatter, file.name);

          if (frontmatter.status === 'archived') continue;

          instincts.push({
            frontmatter,
            l0: parsed.l0,
            l1: parsed.l1,
            body: parsed.body,
            provenance: frontmatter.source ?? 'unknown',
          });
        } catch (err) {
          log.warn('Failed to parse instinct', {
            file: file.name,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return instincts;
    },

    async buildGovernancePrompt(): Promise<string> {
      const sections: string[] = [];

      const core = await this.loadCore();
      if (core) {
        const coreLines = [
          '<governance-core>',
          `**Purpose:** ${core.purpose}`,
          `**Creator:** ${core.creator}`,
          `**Identity:** ${core.identity}`,
        ];
        if (core.values.length > 0) {
          coreLines.push('**Values:**');
          for (const v of core.values) coreLines.push(`- ${v}`);
        }
        if (core.ethics.length > 0) {
          coreLines.push('**Ethics:**');
          for (const e of core.ethics) coreLines.push(`- ${e}`);
        }
        coreLines.push('</governance-core>');
        sections.push(coreLines.join('\n'));
      }

      const rules = await this.loadRules();
      if (rules.length > 0) {
        const ruleLines = ['<governance-rules>'];
        for (const rule of rules) {
          ruleLines.push(`### ${rule.frontmatter.id}`);
          if (rule.l1) {
            ruleLines.push(rule.l1);
          } else {
            ruleLines.push(rule.body);
          }
          ruleLines.push('');
        }
        ruleLines.push('</governance-rules>');
        sections.push(ruleLines.join('\n'));
      }

      const instincts = await this.loadInstincts();
      if (instincts.length > 0) {
        const instinctLines = ['<governance-instincts>'];
        for (const instinct of instincts) {
          const statusTag = instinct.frontmatter.status === 'active' ? '' : ` [${instinct.frontmatter.status}]`;
          instinctLines.push(`- **${instinct.frontmatter.id}**${statusTag}: ${instinct.l0 || instinct.l1}`);
        }
        instinctLines.push('</governance-instincts>');
        sections.push(instinctLines.join('\n'));
      }

      if (sections.length === 0) return '';

      return ['', '<governance>', ...sections, '</governance>'].join('\n');
    },
  };
}
